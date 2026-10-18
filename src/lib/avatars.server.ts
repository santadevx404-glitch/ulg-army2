// صور البروفايل (مجلد avatars). بتتخدم من /api/avatar/<name> للمسجّلين بس.
// التخزين لوكال أو Supabase Storage حسب وضع التخزين (راجع blob-store.server.ts).
import crypto from "node:crypto";
import { blobGet, blobPut, blobRemove } from "./blob-store.server";
import { detectImageExt, isValidImageName, type ImageExt } from "./exam-images.server";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 ميجا
const FOLDER = "avatars";
const MIME: Record<ImageExt, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export function detectAvatarExt(b: Buffer): ImageExt | null {
  return detectImageExt(b);
}

export async function saveAvatar(buf: Buffer, ext: ImageExt): Promise<string> {
  const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  await blobPut(FOLDER, name, buf, MIME[ext]);
  return name;
}

export async function readAvatar(name: string): Promise<{ data: Buffer; type: string } | null> {
  if (!isValidImageName(name)) return null;
  const data = await blobGet(FOLDER, name);
  return data ? { data, type: MIME[name.split(".").pop() as ImageExt] } : null;
}

export async function deleteAvatar(name: string | null): Promise<void> {
  if (!name || !isValidImageName(name)) return;
  await blobRemove(FOLDER, [name]);
}
