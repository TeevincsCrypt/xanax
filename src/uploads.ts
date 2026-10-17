import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { files, type StoredFile } from "./db.js";
import { randomId } from "./security.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Uploads live next to the SQLite file, i.e. on the persistent volume. */
function uploadsDir(): string {
  const dbPath = config.DATABASE_URL.replace(/^file:/, "");
  const base = dbPath === ":memory:" ? join(process.cwd(), "data") : dirname(dbPath);
  const dir = join(base, "uploads");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Sniff the real image type from magic bytes; never trust the browser's content type. */
export function sniffImage(buf: Uint8Array): string | null {
  const b = buf;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Content types we're happy to serve as-is for digital goods; anything else is octet-stream. */
const SAFE_DOWNLOAD_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/epub+zip",
  "text/plain",
  "text/csv",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function safeFilename(name: string): string {
  const cleaned = name.normalize("NFKC").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "download";
}

export type UploadResult = { ok: true; file: StoredFile } | { ok: false; error: string };

export async function saveUpload(file: File, kind: "image" | "digital"): Promise<UploadResult> {
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size === 0) return { ok: false, error: `The ${kind === "image" ? "image" : "file"} you uploaded is empty.` };
  if (file.size > max) return { ok: false, error: `${kind === "image" ? "Image" : "File"} is too large (max ${max / 1024 / 1024} MB).` };
  const buf = new Uint8Array(await file.arrayBuffer());
  let mime: string;
  if (kind === "image") {
    const sniffed = sniffImage(buf);
    if (!sniffed) return { ok: false, error: "Image must be a PNG, JPG, GIF or WebP." };
    mime = sniffed;
  } else {
    mime = SAFE_DOWNLOAD_TYPES.has(file.type) ? file.type : "application/octet-stream";
  }
  const id = randomId(kind === "image" ? "img" : "f", 16);
  writeFileSync(join(uploadsDir(), id), buf);
  const stored = { id, kind, mime, filename: safeFilename(file.name), size: buf.length } as const;
  files.insert(stored);
  return { ok: true, file: files.get(id)! };
}

export function readUpload(id: string): { meta: StoredFile; data: Buffer } | undefined {
  if (!/^(img|f)_[a-z0-9]+$/.test(id)) return undefined;
  const meta = files.get(id);
  if (!meta) return undefined;
  try {
    return { meta, data: readFileSync(join(uploadsDir(), id)) };
  } catch {
    return undefined;
  }
}

export function imageUrl(id: string): string {
  return `${config.BASE_URL}/u/${id}`;
}
