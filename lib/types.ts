export type TicketStatus =
  | "blocked"
  | "ready"
  | "in_progress"
  | "done"
  | "cancelled";

export type Role = "owner" | "contractor";

export interface Ticket {
  ID: string;
  PROJECT_ID: string;
  BRANCH_ID: string;
  FORKED_FROM_ID: string | null;
  TITLE: string;
  DESCRIPTION: string | null;
  STATUS: TicketStatus;
  PLANNED_START: string | null;
  PLANNED_END: string | null;
  ORIGINAL_PLANNED_END: string | null;
  ACTUAL_START: string | null;
  ACTUAL_END: string | null;
  UPDATED_AT: string;
}

export interface Dependency {
  ID: string;
  BRANCH_ID: string;
  PARENT_TICKET_ID: string;
  CHILD_TICKET_ID: string;
}

export interface Branch {
  ID: string;
  PROJECT_ID: string;
  NAME: string;
  FORKED_FROM_BRANCH_ID: string | null;
  FORKED_FROM_TICKET_ID: string | null;
  STATUS: "active" | "merged";
}

export type GptZeroFlag = "human" | "mixed" | "ai" | "unavailable";

export interface Report {
  ID: string;
  TICKET_ID: string;
  SUBMITTED_BY_ROLE: string;
  REPORT_TEXT: string;
  MEDIA_URL: string | null;
  GPTZERO_SCORE: number | null;
  GPTZERO_FLAG: GptZeroFlag | null;
  OWNER_DECISION: "approved" | "rejected" | null;
}

export type AnalysisStatus = "pending" | "running" | "done" | "failed";
export type MediaSource = "report" | "feed";

export interface Media {
  ID: string;
  PROJECT_ID: string;
  BRANCH_ID: string;
  TICKET_ID: string | null;
  REPORT_ID: string | null;
  SOURCE: MediaSource;
  CAMERA_ID: string | null;
  CAPTURED_AT: string | null;
  MIME_TYPE: string;
  BYTE_SIZE: number | null;
  STORAGE_PATH: string;
  ANALYSIS_STATUS: AnalysisStatus;
  ANALYSIS_JSON: string | null;
  ANALYSIS_ERROR: string | null;
  ANALYZED_AT: string | null;
  CREATED_AT: string;
}

/**
 * Grounded output of a Gemini video analysis pass — see lib/video/analyze.ts.
 * Every claim is timestamp-anchored ("MM:SS" into the clip) so the UI can seek
 * the player there, and ticketId is always one of the candidate ids handed to
 * the model (or null) — never a value the model invented.
 */
export interface VideoObservation {
  t: string;
  what: string;
  ticketId: string | null;
  confidence: number;
}

export type TicketObservedState = "not_started" | "in_progress" | "complete" | "not_visible";

export interface TicketFinding {
  ticketId: string;
  observed: TicketObservedState;
  evidence: string[];
  confidence: number;
}

export type ClaimVerdict = "supported" | "partial" | "contradicted" | "unverifiable";

export interface ClaimCheck {
  claim: string;
  verdict: ClaimVerdict;
  why: string;
}

export interface UnexpectedFinding {
  t: string;
  what: string;
}

export interface VideoAnalysis {
  observations: VideoObservation[];
  ticketFindings: TicketFinding[];
  claimChecks: ClaimCheck[];
  unexpected: UnexpectedFinding[];
}

/**
 * A pre-filled call against an existing route — see lib/video/drift.ts. The
 * UI fires it as-is; nothing here mutates the DAG on its own (see docs/plan.md
 * "Video Evidence Pipeline").
 */
export interface Proposal {
  kind: "delay" | "closeable" | "fork" | "new_ticket";
  label: string;
  rationale: string;
  method: "PATCH" | "POST";
  endpoint: string;
  body: Record<string, unknown>;
}
