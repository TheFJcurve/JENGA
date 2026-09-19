import { NextRequest, NextResponse } from "next/server";
import { execute } from "@/lib/db";
import { computeDrift } from "@/lib/video/drift";
import type { Media, Ticket, VideoAnalysis } from "@/lib/types";

/**
 * Polled by the client while analysis runs (see lib/video/analyze.ts —
 * fire-and-forget on upload). Proposals are recomputed here on every read
 * rather than stored, so they stay correct after the owner acts on one — see
 * docs/plan.md "Proposals are not stored."
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [media] = await execute<Media>(`SELECT * FROM media WHERE id = ?`, [id]);
  if (!media) return NextResponse.json({ error: "Media not found" }, { status: 404 });

  if (media.ANALYSIS_STATUS !== "done") {
    return NextResponse.json({ status: media.ANALYSIS_STATUS, error: media.ANALYSIS_ERROR });
  }

  const analysis = JSON.parse(media.ANALYSIS_JSON!) as VideoAnalysis;

  const tickets = await execute<Ticket>(`SELECT * FROM tickets WHERE branch_id = ?`, [
    media.BRANCH_ID,
  ]);
  const edges = await execute<{ PARENT_TICKET_ID: string }>(
    `SELECT DISTINCT parent_ticket_id FROM dependencies WHERE branch_id = ?`,
    [media.BRANCH_ID]
  );

  const proposals = computeDrift(analysis, {
    projectId: media.PROJECT_ID,
    branchId: media.BRANCH_ID,
    contextTicketId: media.TICKET_ID,
    tickets,
    hasDependents: new Set(edges.map((e) => e.PARENT_TICKET_ID)),
  });

  return NextResponse.json({ status: "done", analysis, proposals });
}
