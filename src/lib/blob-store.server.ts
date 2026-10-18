// تخزين الملفات (الصور): محلي في data/<folder>/ أو في Supabase Storage (bucket خاص) حسب وضع التخزين.
// الـ bucket خاص (private) والصور بتتخدم من الـ API routes بتاعتنا بعد فحص الصلاحيات،
// فمحدش يقدر يوصل لصورة بالرابط المباشر.
import fs from "node:fs";
import path from "node:path";
import { USE_LOCAL_STORAGE, getSupabase } from "./kv-store.server";

export const FILES_BUCKET = process.env.SUPABASE_FILES_BUCKET || "app-files";

const localDir = (folder: string) => path.resolve(process.cwd(), "data", folder);

let bucketReady: Promise<void> | null = null;
/** بيعمل الـ bucket لو مش موجود (مرة واحدة). */
export function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { error } = await getSupabase().storage.createBucket(FILES_BUCKET, { public: false });
      if (error) {
        const msg = `${error.message ?? ""}`;
        const code = String((error as { statusCode?: string | number }).statusCode ?? "");
        if (!/already exists|duplicate|exists/i.test(msg) && code !== "409") {
          throw new Error(`Supabase Storage: مقدرتش أجهّز الـ bucket «${FILES_BUCKET}» — ${msg}`);
        }
      }
    })().catch((e) => {
      bucketReady = null;
      throw e;
    });
  }
  return bucketReady;
}

export async function blobPut(folder: string, name: string, buf: Buffer, contentType: string): Promise<void> {
  if (USE_LOCAL_STORAGE) {
    fs.mkdirSync(localDir(folder), { recursive: true });
    fs.writeFileSync(path.join(localDir(folder), name), buf);
    return;
  }
  await ensureBucket();
  const { error } = await getSupabase().storage.from(FILES_BUCKET).upload(`${folder}/${name}`, buf, { contentType, upsert: true });
  if (error) throw new Error(`Supabase Storage upload error: ${error.message}`);
}

export async function blobGet(folder: string, name: string): Promise<Buffer | null> {
  if (USE_LOCAL_STORAGE) {
    const file = path.join(localDir(folder), name);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
  await ensureBucket();
  const { data, error } = await getSupabase().storage.from(FILES_BUCKET).download(`${folder}/${name}`);
  if (error || !data) return null; // مش موجود
  return Buffer.from(await data.arrayBuffer());
}

export async function blobExists(folder: string, name: string): Promise<boolean> {
  if (USE_LOCAL_STORAGE) return fs.existsSync(path.join(localDir(folder), name));
  await ensureBucket();
  const { data, error } = await getSupabase().storage.from(FILES_BUCKET).list(folder, { search: name, limit: 5 });
  if (error) throw new Error(`Supabase Storage list error: ${error.message}`);
  return (data ?? []).some((f) => f.name === name);
}

export async function blobRemove(folder: string, names: string[]): Promise<void> {
  if (names.length === 0) return;
  if (USE_LOCAL_STORAGE) {
    for (const n of names) {
      try { fs.unlinkSync(path.join(localDir(folder), n)); } catch { /* مش موجودة */ }
    }
    return;
  }
  await ensureBucket();
  const { error } = await getSupabase().storage.from(FILES_BUCKET).remove(names.map((n) => `${folder}/${n}`));
  if (error) throw new Error(`Supabase Storage remove error: ${error.message}`);
}
