// مخزن صور عام (بيستخدمه الدردشة والإعلانات). كل ميزة ليها مجلد (dirName).
// التخزين لوكال أو Supabase Storage حسب وضع التخزين (راجع blob-store.server.ts).
import crypto from "node:crypto";
import { blobExists, blobGet, blobPut, blobRemove } from "./blob-store.server";
import { detectImageExt, isValidImageName, type ImageExt } from "./exam-images.server";

export { detectImageExt, isValidImageName };
export type { ImageExt };

const MIME: Record<ImageExt, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export function makeImageStore(dirName: string, maxBytes: number) {
  return {
    maxBytes,
    async save(buf: Buffer, ext: ImageExt): Promise<string> {
      const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
      await blobPut(dirName, name, buf, MIME[ext]);
      return name;
    },
    async read(name: string): Promise<{ data: Buffer; type: string } | null> {
      if (!isValidImageName(name)) return null;
      const data = await blobGet(dirName, name);
      return data ? { data, type: MIME[name.split(".").pop() as ImageExt] } : null;
    },
    async exists(name: string): Promise<boolean> {
      return isValidImageName(name) && (await blobExists(dirName, name));
    },
    async remove(names: (string | null | undefined)[]): Promise<void> {
      await blobRemove(dirName, names.filter((n): n is string => !!n && isValidImageName(n)));
    },
  };
}
