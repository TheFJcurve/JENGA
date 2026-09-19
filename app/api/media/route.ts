import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { execute } from "@/lib/db";
import { put } from "@/lib/media-store";
import { runAnalysis } from "@/lib/video/analyze";

export async function GET(req: NextRequest) {
  const reportId = req.nextUrl.searchParams.get("reportId");
  if (!reportId) {
    return NextResponse.json({ error: "reportId is required" }, { status: 400 });
  }
  const rows = await execute(`SELECT * FROM media WHERE report_id = ? ORDER BY created_at DESC`, [
    reportId,
  ]);
  return NextResponse.json(rows);
}

/**
 * Accepts a clip regardless of where it came from — a contractor's report
 * upload today, an unattended site camera later (see docs/plan.md "Source-
 * agnostic ingest"). `ticketId`/`reportId` are optional so a feed clip can be
 * stored before anything attributes it to a ticket.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const projectId = form.get("projectId");
  const branchId = form.get("branchId");
  if (typeof projectId !== "string" || typeof branchId !== "string") {
    return NextResponse.json({ error: "projectId and branchId are required" }, { status: 400 });
  }
  const ticketId = form.get("ticketId");
  const reportId = form.get("reportId");
  const source = form.get("source") === "feed" ? "feed" : "report";

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const { storagePath } = await put(buffer, mimeType);

  const id = randomUUID();
  await execute(
    `INSERT INTO media
       (id, project_id, branch_id, ticket_id, report_id, source, mime_type, byte_size, storage_path, analysis_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      id,
      projectId,
      branchId,
      typeof ticketId === "string" ? ticketId : null,
      typeof reportId === "string" ? reportId : null,
      source,
      mimeType,
      buffer.byteLength,
      storagePath,
    ]
  );

  // Fire-and-forget: see lib/video/analyze.ts for why this isn't awaited.
  void runAnalysis(id);

  return NextResponse.json({ id }, { status: 201 });
}
