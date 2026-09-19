import { NextRequest, NextResponse } from "next/server";
import { execute } from "@/lib/db";
import { read } from "@/lib/media-store";
import type { Media } from "@/lib/types";

// ponytail: no HTTP Range support, so the <video> element downloads the whole
// clip before it can play/seek. Fine for the short walkthrough clips this demo
// uses; add Range handling if clips get long enough that matters.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [media] = await execute<Media>(`SELECT * FROM media WHERE id = ?`, [id]);
  if (!media) return NextResponse.json({ error: "Media not found" }, { status: 404 });

  const buffer = await read(media.STORAGE_PATH);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": media.MIME_TYPE,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
