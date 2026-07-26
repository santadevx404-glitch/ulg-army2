// طبقة تخزين مفتاح/قيمة فوق Supabase (جدول واحد بسيط بعمود JSONB) — شغالة
// على Vercel (وأي سيرفر تاني) لأنها مش بتكتب على القرص المحلي خالص.
//
// الإعداد المطلوب في Supabase (مرة واحدة بس، من SQL Editor):
//
//   create table if not exists app_kv (
//     key text primary key,
//     value jsonb not null
//   );
//
// الإعداد المطلوب في Vercel (Settings -> Environment Variables):
//   SUPABASE_URL              = رابط مشروعك (من Settings -> API)
//   SUPABASE_SERVICE_ROLE_KEY = الـ "Secret key" (مش الـ Publishable) من نفس الصفحة
//
// بعد إضافة المتغيرات، لازم تعمل Redeploy للمشروع.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "متغيرات SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY مش موجودة — ضيفهم في إعدادات المشروع على Vercel واعمل Redeploy.",
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export async function kvGetJSON<T>(key: string, fallback: T): Promise<T> {
  const supabase = getClient();
  const { data, error } = await supabase.from("app_kv").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`Supabase read error: ${error.message}`);
  if (!data) return fallback;
  return data.value as T;
}

export async function kvSetJSON(key: string, value: unknown): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.from("app_kv").upsert({ key, value: value as any });
  if (error) throw new Error(`Supabase write error: ${error.message}`);
}
