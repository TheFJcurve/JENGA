import { GoogleGenAI, Type } from "@google/genai";
import { execute, now } from "@/lib/db";
import { absolutePath } from "@/lib/media-store";
import type { Media, Ticket, VideoAnalysis } from "@/lib/types";

/**
 * Turns an uploaded clip into grounded, DAG-comparable findings. Mirrors
 * lib/gptzero.ts's shape deliberately: env-key-gated, never throws out of
 * `runAnalysis`, degrades to a stored 'failed' status with a message rather
 * than blocking anything upstream. See docs/plan.md "Video Evidence Pipeline"
 * for why the model is asked for grounded observations against a closed set
 * of tickets rather than an open-ended progress judgement.
 */

const TIMESTAMP = /^\d{1,2}:\d{2}(:\d{2})?$/;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    observations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          t: { type: Type.STRING, description: "Timestamp into the clip, MM:SS" },
          what: { type: Type.STRING, description: "What is observed, factually — no judgement" },
          ticketId: {
            type: Type.STRING,
            nullable: true,
            description: "One of the candidate ticket ids this observation relates to, or null",
          },
          confidence: { type: Type.NUMBER },
        },
        required: ["t", "what", "confidence"],
      },
    },
    ticketFindings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          ticketId: { type: Type.STRING, description: "Must be one of the candidate ticket ids" },
          observed: {
            type: Type.STRING,
            format: "enum",
            enum: ["not_started", "in_progress", "complete", "not_visible"],
          },
          evidence: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Timestamps (MM:SS) supporting this finding",
          },
          confidence: { type: Type.NUMBER },
        },
        required: ["ticketId", "observed", "evidence", "confidence"],
      },
    },
    claimChecks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          claim: { type: Type.STRING, description: "A specific claim from the contractor's report text" },
          verdict: {
            type: Type.STRING,
            format: "enum",
            enum: ["supported", "partial", "contradicted", "unverifiable"],
          },
          why: { type: Type.STRING, description: "Cite timestamps; no verdict without visual/audio evidence" },
        },
        required: ["claim", "verdict", "why"],
      },
    },
    unexpected: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          t: { type: Type.STRING },
          what: { type: Type.STRING, description: "Work or a condition visible on camera that no candidate ticket covers" },
        },
        required: ["t", "what"],
      },
    },
  },
  required: ["observations", "ticketFindings", "claimChecks", "unexpected"],
};

const PROMPT_HEADER = `You are reviewing construction site footage against a specific set of tickets on a project board. Only use the candidate tickets listed below — never invent a ticket id, and use null when an observation doesn't clearly belong to any of them.

Rules:
- Every observation and every piece of evidence must carry a timestamp (MM:SS) into the clip. If you can't point to a moment, don't include the claim.
- For ticketFindings, "not_visible" is a valid and often correct answer — use it whenever the ticket's work simply never appears on camera, rather than guessing done or not-done.
- Never estimate a percent-complete or any other number describing progress. Describe only what is observably true (e.g. "one lane surfaced, second lane still gravel").
- claimChecks: check the specific claims made in the contractor's report text below against the footage (audio included). If there is no report text, return an empty list.
- unexpected: anything visible that isn't covered by any candidate ticket (safety issues, unplanned work, equipment, weather/site conditions).

Candidate tickets (branch-scoped):
`;

interface CandidateTicket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
}

function buildPrompt(candidates: CandidateTicket[], reportText: string | null): string {
  const ticketLines = candidates
    .map(
      (t) =>
        `- id=${t.id} "${t.title}" (status=${t.status}, planned ${t.plannedStart ?? "?"} -> ${t.plannedEnd ?? "?"})${t.description ? `: ${t.description}` : ""}`
    )
    .join("\n");
  const reportBlock = reportText
    ? `\nContractor's report text to check claims against:\n"""\n${reportText}\n"""`
    : "\n(No report text submitted with this clip.)";
  return `${PROMPT_HEADER}${ticketLines}${reportBlock}`;
}

/** Drops anything not grounded in the candidate set or missing a timestamp — never trust the model's own bookkeeping. */
function sanitize(raw: VideoAnalysis, candidateIds: Set<string>): VideoAnalysis {
  return {
    observations: raw.observations.filter(
      (o) => TIMESTAMP.test(o.t) && (o.ticketId === null || candidateIds.has(o.ticketId))
    ),
    ticketFindings: raw.ticketFindings.filter(
      (f) => candidateIds.has(f.ticketId) && f.evidence.every((t) => TIMESTAMP.test(t)) && f.evidence.length > 0
    ),
    claimChecks: raw.claimChecks,
    unexpected: raw.unexpected.filter((u) => TIMESTAMP.test(u.t)),
  };
}

async function callGemini(ai: GoogleGenAI, filePath: string, mimeType: string, prompt: string): Promise<VideoAnalysis> {
  const file = await ai.files.upload({ file: filePath, config: { mimeType } });
  let info = file;
  const deadline = Date.now() + 60_000;
  while (info.state === "PROCESSING" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    info = await ai.files.get({ name: info.name! });
  }
  if (info.state !== "ACTIVE") throw new Error(`Gemini file processing did not complete (state=${info.state})`);

  const attempt = async (): Promise<VideoAnalysis> => {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
      contents: [
        { fileData: { fileUri: info.uri!, mimeType: info.mimeType! } },
        { text: prompt },
      ],
      config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned no text");
    return JSON.parse(text) as VideoAnalysis;
  };

  try {
    return await attempt();
  } catch {
    return await attempt(); // one retry on a parse/empty-response hiccup, then give up
  }
}

/**
 * Fire-and-forget from the upload route (see app/api/media/route.ts) — a
 * multi-minute clip is 20-60s+ of Gemini time, too long to block the request.
 * ponytail: in-process async work with no queue or retry-on-crash; fine on a
 * long-lived `next start`/`next dev` process, needs a real job queue on
 * serverless. Never throws — callers only need to fire it and move on.
 */
export async function runAnalysis(mediaId: string): Promise<void> {
  try {
    const [media] = await execute<Media>(`SELECT * FROM media WHERE id = ?`, [mediaId]);
    if (!media) return;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await execute(
        `UPDATE media SET analysis_status = 'failed', analysis_error = ? WHERE id = ?`,
        ["Gemini API key not configured", mediaId]
      );
      return;
    }

    await execute(`UPDATE media SET analysis_status = 'running' WHERE id = ?`, [mediaId]);

    const candidateRows = await execute<Ticket>(`SELECT * FROM tickets WHERE branch_id = ?`, [
      media.BRANCH_ID,
    ]);
    const candidates: CandidateTicket[] = candidateRows.map((t) => ({
      id: t.ID,
      title: t.TITLE,
      description: t.DESCRIPTION,
      status: t.STATUS,
      plannedStart: t.PLANNED_START,
      plannedEnd: t.PLANNED_END,
    }));

    let reportText: string | null = null;
    if (media.REPORT_ID) {
      const [report] = await execute<{ REPORT_TEXT: string }>(
        `SELECT report_text FROM reports WHERE id = ?`,
        [media.REPORT_ID]
      );
      reportText = report?.REPORT_TEXT ?? null;
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildPrompt(candidates, reportText);
    const raw = await callGemini(ai, absolutePath(media.STORAGE_PATH), media.MIME_TYPE, prompt);
    const analysis = sanitize(raw, new Set(candidates.map((c) => c.id)));

    await execute(
      `UPDATE media SET analysis_status = 'done', analysis_json = ?, analyzed_at = ${now()} WHERE id = ?`,
      [JSON.stringify(analysis), mediaId]
    );
  } catch (err) {
    await execute(
      `UPDATE media SET analysis_status = 'failed', analysis_error = ? WHERE id = ?`,
      [err instanceof Error ? err.message : String(err), mediaId]
    ).catch(() => {});
  }
}
