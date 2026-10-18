// تخزين صور إجابات الاختبارات (مجلد exam-uploads). بتتخدم من /api/exam-image/<name>.
// التخزين لوكال أو Supabase Storage حسب وضع التخزين (راجع blob-store.server.ts).
import crypto from "node:crypto";
import { blobGet, blobPut, blobRemove } from "./blob-store.server";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 ميجا (حد Vercel لحجم الطلب ~4.5 ميجا)
const FOLDER = "exam-uploads";

export type ImageExt = "jpg" | "png" | "webp" | "gif";

const MIME: Record<ImageExt, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

/** بيتأكد من نوع الملف من البايتات نفسها (مش من الاسم/الـ header) */
export function detectImageExt(b: Buffer): ImageExt | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  const g = b.subarray(0, 6).toString("ascii");
  if (g === "GIF87a" || g === "GIF89a") return "gif";
  return null;
}

const NAME_RE = /^[0-9a-f]{32}\.(jpg|png|webp|gif)$/;
export function isValidImageName(name: string): boolean {
  return NAME_RE.test(name);
}

export async function saveExamImage(buf: Buffer, ext: ImageExt): Promise<string> {
  const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  await blobPut(FOLDER, name, buf, MIME[ext]);
  return name;
}

export async function readExamImage(name: string): Promise<{ data: Buffer; type: string } | null> {
  if (!isValidImageName(name)) return null;
  const data = await blobGet(FOLDER, name);
  return data ? { data, type: MIME[name.split(".").pop() as ImageExt] } : null;
}

export async function deleteExamImages(names: string[]): Promise<void> {
  await blobRemove(FOLDER, names.filter(isValidImageName));
}
