"use client";

import { useEffect, useRef, useState } from "react";
import type { Media, Proposal, VideoAnalysis } from "@/lib/types";

function parseTimestamp(t: string): number {
  const parts = t.split(":").map(Number);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + (parts[1] ?? 0);
}

const VERDICT_LABEL: Record<string, string> = {
  supported: "Supported",
  partial: "Partially supported",
  contradicted: "Contradicted",
  unverifiable: "Unverifiable",
};

/**
 * Shown next to a pending report — the player plus the grounded, timestamped
 * findings from lib/video/analyze.ts, and any drift-computed proposals from
 * lib/video/drift.ts as one-click buttons. Polls while analysis is still
 * running; never blocks the report approve/reject flow around it.
 */
export function VideoEvidence({
  reportId,
  onProposalApplied,
}: {
  reportId: string;
  onProposalApplied: () => void;
}) {
  const [media, setMedia] = useState<Media | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const [m] = await fetch(`/api/media?reportId=${reportId}`).then((r) => r.json());
      if (cancelled || !m) return;
      setMedia(m);

      const result = await fetch(`/api/media/${m.ID}/analysis`).then((r) => r.json());
      if (cancelled) return;
      setStatus(result.status);
      setError(result.error ?? null);
      if (result.status === "done") {
        setAnalysis(result.analysis);
        setProposals(result.proposals);
      } else if (result.status === "pending" || result.status === "running") {
        timer = setTimeout(poll, 3000);
      }
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reportId]);

  const seekTo = (t: string) => {
    if (videoRef.current) videoRef.current.currentTime = parseTimestamp(t);
  };

  const applyProposal = async (proposal: Proposal) => {
    setBusy(true);
    try {
      await fetch(proposal.endpoint, {
        method: proposal.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposal.body),
      });
      setProposals((prev) => prev.filter((p) => p !== proposal));
      onProposalApplied();
    } finally {
      setBusy(false);
    }
  };

  if (!media) return null;

  return (
    <div className="flex flex-col gap-2 rounded border p-2">
      <video ref={videoRef} controls className="w-full rounded" src={`/api/media/${media.ID}`} />

      {status !== "done" && (
        <p className="text-xs text-zinc-500">
          {status === "failed"
            ? `Video analysis unavailable${error ? ` (${error})` : ""}`
            : "Analyzing footage..."}
        </p>
      )}

      {analysis && (
        <div className="flex flex-col gap-2 text-xs">
          {analysis.ticketFindings.length > 0 && (
            <div>
              <p className="font-medium text-zinc-600">What the footage shows</p>
              {analysis.ticketFindings.map((f, i) => (
                <p key={i}>
                  {f.observed.replace("_", " ")} —{" "}
                  {f.evidence.map((t, j) => (
                    <button
                      key={j}
                      className="underline decoration-dotted"
                      onClick={() => seekTo(t)}
                    >
                      {t}
                      {j < f.evidence.length - 1 ? ", " : ""}
                    </button>
                  ))}
                </p>
              ))}
            </div>
          )}

          {analysis.claimChecks.length > 0 && (
            <div>
              <p className="font-medium text-zinc-600">Claim checks</p>
              {analysis.claimChecks.map((c, i) => (
                <p key={i} className={c.verdict === "contradicted" ? "text-red-600" : undefined}>
                  {VERDICT_LABEL[c.verdict]}: {c.claim} — {c.why}
                </p>
              ))}
            </div>
          )}

          {analysis.unexpected.length > 0 && (
            <div>
              <p className="font-medium text-zinc-600">Unexpected on camera</p>
              {analysis.unexpected.map((u, i) => (
                <p key={i}>
                  <button className="underline decoration-dotted" onClick={() => seekTo(u.t)}>
                    {u.t}
                  </button>{" "}
                  — {u.what}
                </p>
              ))}
            </div>
          )}

          {proposals.length > 0 && (
            <div className="flex flex-col gap-1 border-t pt-2">
              <p className="font-medium text-zinc-600">Proposed changes</p>
              {proposals.map((p, i) => (
                <div key={i} className="flex flex-col gap-1 rounded border border-blue-200 bg-blue-50 p-2">
                  <p className="text-zinc-700">{p.rationale}</p>
                  <button
                    disabled={busy}
                    className="self-start rounded bg-blue-600 px-2 py-1 text-white disabled:opacity-50"
                    onClick={() => applyProposal(p)}
                  >
                    {p.label}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
