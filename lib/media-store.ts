import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// ponytail: local disk, single-process, path fixed (not env-configurable) so
// Next's file tracer can scope it statically instead of bundling the whole
// project. Fine for `next dev`/`next start` on one machine (the hackathon demo
// target); swap for S3/R2 before deploying anywhere with multiple instances or
// ephemeral disk (e.g. most serverless platforms).
const MEDIA_DIR = path.resolve(process.cwd(), ".data/media");

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Writes `buffer` under a fresh id and returns that id plus its storage path (relative — this is what gets persisted in `media.storage_path`). */
export async function put(
  buffer: Buffer,
  mimeType: string
): Promise<{ id: string; storagePath: string }> {
  await mkdir(MEDIA_DIR, { recursive: true });
  const id = randomUUID();
  const ext = EXT_BY_MIME[mimeType] ?? "bin";
  const storagePath = `${id}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, storagePath), buffer);
  return { id, storagePath };
}

/** Absolute filesystem path for a stored `storagePath` — used both to stream it back and to hand it to the Gemini Files API. */
export function absolutePath(storagePath: string): string {
  return path.join(MEDIA_DIR, storagePath);
}

export async function read(storagePath: string): Promise<Buffer> {
  return readFile(absolutePath(storagePath));
}
