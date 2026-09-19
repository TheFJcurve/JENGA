import type { Proposal, Ticket, VideoAnalysis } from "@/lib/types";

/**
 * Pure, synchronous comparison of a video analysis against current ticket
 * state — never calls the DB or an LLM, so it can't hallucinate and is cheap
 * to test (see drift.check.ts). Every proposal is a pre-filled call against an
 * existing route (see docs/plan.md "Proposals reuse existing endpoints") —
 * this function only decides *whether* to offer one, never applies it.
 */

const DAY_MS = 86_400_000;
const IMMINENT_DAYS = 2; // flag a not-yet-overdue ticket only once its planned end is this close

export interface DriftInput {
  projectId: string;
  branchId: string;
  /** The ticket the clip/report is about, if any — used to place a fork proposal. */
  contextTicketId: string | null;
  /** Current tickets in this branch, for status/date lookup by id. */
  tickets: Ticket[];
  /** Ticket ids that have at least one dependent edge — forking only matters where there's downstream to protect. */
  hasDependents: Set<string>;
  /** Injectable for tests; defaults to the real clock. */
  today?: Date;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function computeDrift(analysis: VideoAnalysis, input: DriftInput): Proposal[] {
  const { tickets, hasDependents, contextTicketId, projectId, branchId } = input;
  const today = input.today ?? new Date();
  const byId = new Map(tickets.map((t) => [t.ID, t]));
  const proposals: Proposal[] = [];

  for (const finding of analysis.ticketFindings) {
    const ticket = byId.get(finding.ticketId);
    if (!ticket) continue;

    if (finding.observed === "complete") {
      if (ticket.STATUS === "in_progress") {
        proposals.push({
          kind: "closeable",
          label: `Mark "${ticket.TITLE}" done`,
          rationale: `Footage shows this ticket's work complete (evidence at ${finding.evidence.join(", ")}), but it's still marked in_progress.`,
          method: "PATCH",
          endpoint: `/api/tickets/${ticket.ID}`,
          body: { status: "done" },
        });
      }
      continue;
    }

    if (finding.observed === "not_started" || finding.observed === "in_progress") {
      if (!ticket.PLANNED_END) continue;
      const plannedEnd = new Date(ticket.PLANNED_END);
      const daysUntilDue = Math.round((plannedEnd.getTime() - today.getTime()) / DAY_MS);
      if (daysUntilDue > IMMINENT_DAYS) continue; // due date isn't close enough to flag yet

      const overdueDays = Math.max(0, -daysUntilDue);
      const delayDays = overdueDays > 0 ? overdueDays + 2 : 3; // pad overdue work; default nudge when merely imminent
      const newEnd = new Date(plannedEnd.getTime() + delayDays * DAY_MS);
      const state = finding.observed === "not_started" ? "not started" : "still in progress";
      proposals.push({
        kind: "delay",
        label: `Delay "${ticket.TITLE}" by ${delayDays} day${delayDays === 1 ? "" : "s"}`,
        rationale:
          overdueDays > 0
            ? `Footage shows this ticket ${state} (evidence at ${finding.evidence.join(", ")}), ${overdueDays} day(s) past its planned end.`
            : `Footage shows this ticket ${state} (evidence at ${finding.evidence.join(", ")}) with its planned end approaching.`,
        method: "PATCH",
        endpoint: `/api/tickets/${ticket.ID}`,
        body: { plannedEnd: newEnd.toISOString().slice(0, 10) },
      });
    }
  }

  const contradicted = analysis.claimChecks.filter((c) => c.verdict === "contradicted");
  if (contradicted.length > 0 && contextTicketId && hasDependents.has(contextTicketId)) {
    const ticket = byId.get(contextTicketId);
    if (ticket) {
      proposals.push({
        kind: "fork",
        label: `Fork an alternate timeline at "${ticket.TITLE}"`,
        rationale: `Footage contradicts the report: ${contradicted.map((c) => c.why).join("; ")}`,
        method: "POST",
        endpoint: `/api/branches`,
        body: {
          projectId,
          fromBranchId: branchId,
          forkTicketId: ticket.ID,
          name: `${ticket.TITLE} — re-plan`,
        },
      });
    }
  }

  for (const u of analysis.unexpected) {
    proposals.push({
      kind: "new_ticket",
      label: `Create ticket: ${truncate(u.what, 60)}`,
      rationale: `Unplanned work/condition visible on camera at ${u.t}, not covered by any existing ticket.`,
      method: "POST",
      endpoint: `/api/tickets`,
      body: {
        projectId,
        branchId,
        title: truncate(u.what, 80),
        description: `Flagged from video analysis at ${u.t}.`,
      },
    });
  }

  return proposals;
}
