import assert from "node:assert/strict";
import { computeDrift } from "./drift";
import type { Ticket, VideoAnalysis } from "@/lib/types";

// ponytail: assert-based self-check, not a test framework — run with
// `npx tsx lib/video/drift.check.ts` (see package.json's `check:drift`).

const TODAY = new Date("2026-10-12"); // fixed clock so "overdue"/"imminent" fixtures are stable

function ticket(overrides: Partial<Ticket> & Pick<Ticket, "ID" | "TITLE" | "STATUS">): Ticket {
  return {
    PROJECT_ID: "proj-1",
    BRANCH_ID: "branch-1",
    FORKED_FROM_ID: null,
    DESCRIPTION: null,
    PLANNED_START: null,
    PLANNED_END: null,
    ACTUAL_START: null,
    ACTUAL_END: null,
    UPDATED_AT: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const emptyAnalysis: VideoAnalysis = {
  observations: [],
  ticketFindings: [],
  claimChecks: [],
  unexpected: [],
};

function drift(analysis: VideoAnalysis, tickets: Ticket[], opts: Partial<{ contextTicketId: string | null; hasDependents: Set<string> }> = {}) {
  return computeDrift(analysis, {
    projectId: "proj-1",
    branchId: "branch-1",
    contextTicketId: opts.contextTicketId ?? null,
    tickets,
    hasDependents: opts.hasDependents ?? new Set(),
    today: TODAY,
  });
}

// 1. Overdue, not started -> delay proposal.
{
  const t = ticket({ ID: "t1", TITLE: "Segment A Paving", STATUS: "in_progress", PLANNED_END: "2026-10-10" });
  const proposals = drift(
    { ...emptyAnalysis, ticketFindings: [{ ticketId: "t1", observed: "not_started", evidence: ["00:10"], confidence: 0.8 }] },
    [t]
  );
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "delay");
  assert.equal(proposals[0].endpoint, "/api/tickets/t1");
  assert.equal((proposals[0].body as { plannedEnd: string }).plannedEnd, "2026-10-14"); // 2 overdue + 2 pad = 4 days
}

// 2. Complete but still in_progress on the board -> closeable proposal.
{
  const t = ticket({ ID: "t2", TITLE: "Height Clearance", STATUS: "in_progress" });
  const proposals = drift(
    { ...emptyAnalysis, ticketFindings: [{ ticketId: "t2", observed: "complete", evidence: ["01:00"], confidence: 0.9 }] },
    [t]
  );
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "closeable");
  assert.deepEqual(proposals[0].body, { status: "done" });
}

// 3. Complete AND already done on the board -> no proposal (the "no delay on an
//    overdue-but-complete ticket" case named in docs/plan.md's verification section).
{
  const t = ticket({ ID: "t3", TITLE: "Site Survey", STATUS: "done", PLANNED_END: "2026-10-01" });
  const proposals = drift(
    { ...emptyAnalysis, ticketFindings: [{ ticketId: "t3", observed: "complete", evidence: ["00:05"], confidence: 0.9 }] },
    [t]
  );
  assert.equal(proposals.length, 0);
}

// 4. not_visible -> honest non-answer, no proposal.
{
  const t = ticket({ ID: "t4", TITLE: "Truck Logistics", STATUS: "in_progress", PLANNED_END: "2026-10-01" });
  const proposals = drift(
    { ...emptyAnalysis, ticketFindings: [{ ticketId: "t4", observed: "not_visible", evidence: [], confidence: 0.5 }] },
    [t]
  );
  assert.equal(proposals.length, 0);
}

// 5. Contradicted claim on a ticket with downstream dependents -> fork proposal.
{
  const t = ticket({ ID: "t5", TITLE: "Segment B Paving", STATUS: "in_progress" });
  const proposals = drift(
    { ...emptyAnalysis, claimChecks: [{ claim: "both lanes done", verdict: "contradicted", why: "second lane still gravel at 01:02" }] },
    [t],
    { contextTicketId: "t5", hasDependents: new Set(["t5"]) }
  );
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "fork");
  assert.equal((proposals[0].body as { forkTicketId: string }).forkTicketId, "t5");
}

// 6. Same contradiction, but the ticket has no downstream dependents -> no fork.
{
  const t = ticket({ ID: "t6", TITLE: "Line Painting", STATUS: "in_progress" });
  const proposals = drift(
    { ...emptyAnalysis, claimChecks: [{ claim: "painted", verdict: "contradicted", why: "not painted at 00:20" }] },
    [t],
    { contextTicketId: "t6", hasDependents: new Set() }
  );
  assert.equal(proposals.length, 0);
}

// 7. Unexpected finding -> new_ticket proposal, regardless of the board state.
{
  const proposals = drift(
    { ...emptyAnalysis, unexpected: [{ t: "02:10", what: "standing water in subgrade" }] },
    []
  );
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "new_ticket");
  assert.equal((proposals[0].body as { title: string }).title, "standing water in subgrade");
}

// 8. Ticket finding referencing an id not in the branch (should never happen post
//    lib/video/analyze.ts sanitization, but drift must not throw on it either way).
{
  const proposals = drift(
    { ...emptyAnalysis, ticketFindings: [{ ticketId: "ghost", observed: "not_started", evidence: ["00:01"], confidence: 0.5 }] },
    []
  );
  assert.equal(proposals.length, 0);
}

console.log("ok — lib/video/drift.ts: 8/8 checks passed");
