// فحص الاتصال بالتخزين (للأدمن الأساسي بس): بيجرّب الجدول والـ version وحماية التعارض والـ bucket.
// ?quick=1 بيرجع الوضع الحالي بس من غير ما يكتب حاجة.
import { createFileRoute } from "@tanstack/react-router";
import fs from "node:fs";
import path from "node:path";
import * as access from "@/lib/access.server";
import { FILES_BUCKET, blobExists, blobGet, blobPut, blobRemove } from "@/lib/blob-store.server";
import { STORAGE_MODE, USE_LOCAL_STORAGE, getSupabase, kvGetJSON, kvSetJSON, kvTransaction, kvVersion } from "@/lib/kv-store.server";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

type Step = { name: string; ok: boolean; detail: string; hint?: string };

function hintFor(msg: string): string | undefined {
  if (/version/i.test(msg) && /(column|schema cache)/i.test(msg)) return "شغّل ملف supabase/setup.sql في SQL Editor (فيه إضافة عمود version).";
  if (/app_kv/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg)) return "الجدول مش موجود — شغّل ملف supabase/setup.sql في SQL Editor.";
  if (/invalid api key|jwt|unauthorized/i.test(msg)) return "المفتاح غلط — لازم الـ Secret / service_role key (مش الـ Publishable).";
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(msg)) return "مش قادر يوصل لـ SUPABASE_URL — راجع الرابط.";
  if (/bucket/i.test(msg)) return "راجع صلاحيات الـ Storage أو أنشئ الـ bucket يدويًا (Private).";
  return undefined;
}

async function step(steps: Step[], name: string, fn: () => Promise<string>) {
  try {
    steps.push({ name, ok: true, detail: await fn() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ name, ok: false, detail: msg, hint: hintFor(msg) });
  }
}

export const Route = createFileRoute("/api/storage-check")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const actor = await access.actorFromRequest(request);
        if (!actor?.owner) return json({ error: "للأدمن الأساسي بس" }, 403);

        let host: string | null = null;
        try { host = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null; } catch { /* ignore */ }
        const info = { mode: STORAGE_MODE, bucket: USE_LOCAL_STORAGE ? null : FILES_BUCKET, host };
        if (new URL(request.url).searchParams.get("quick") === "1") return json({ info });

        const steps: Step[] = [];
        if (USE_LOCAL_STORAGE) {
          await step(steps, "مجلد data/ قابل للكتابة", async () => {
            const dir = path.resolve(process.cwd(), "data");
            fs.mkdirSync(dir, { recursive: true });
            const f = path.join(dir, ".write-test");
            fs.writeFileSync(f, "ok");
            fs.unlinkSync(f);
            return "تمام (وضع لوكال — للربط بـ Supabase ضيف المتغيرات في .env)";
          });
        } else {
          await step(steps, "متغيرات Supabase", async () => {
            if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY ناقصين");
            return `موجودة (${host})`;
          });
          const key = "bwd:__healthcheck";
          await step(steps, "جدول app_kv: قراءة وكتابة", async () => {
            const stamp = Date.now();
            await kvTransaction(async () => {
              await kvGetJSON(key, null);
              await kvSetJSON(key, { stamp });
            });
            const back = await kvGetJSON<{ stamp?: number } | null>(key, null);
            if (back?.stamp !== stamp) throw new Error("القيمة اللي اتكتبت مش هي اللي اترجعت");
            return "تمام";
          });
          await step(steps, "عمود version", async () => {
            const v1 = await kvVersion(key);
            if (v1 === null) throw new Error("عمود version مش موجود أو الصف مش اتكتب");
            await kvTransaction(async () => {
              await kvGetJSON(key, null);
              await kvSetJSON(key, { stamp: Date.now() });
            });
            const v2 = await kvVersion(key);
            if (v2 !== v1 + 1) throw new Error(`الـ version المفروض يزيد 1 (كان ${v1} وبقى ${v2})`);
            return `بيزيد مع كل كتابة (${v1} ← ${v2})`;
          });
          await step(steps, "حماية التعارض (الكتابة المشروطة)", async () => {
            const sb = getSupabase();
            const v = await kvVersion(key);
            const a = await sb.from("app_kv").update({ value: { t: 1 } as never, version: (v ?? 0) + 1 }).eq("key", key).eq("version", v ?? 0).select("version");
            if (a.error) throw new Error(a.error.message);
            const b = await sb.from("app_kv").update({ value: { t: 2 } as never, version: (v ?? 0) + 1 }).eq("key", key).eq("version", v ?? 0).select("version");
            if (b.error) throw new Error(b.error.message);
            if ((a.data?.length ?? 0) !== 1 || (b.data?.length ?? 0) !== 0) throw new Error("التحديث المشروط مش شغال زي المتوقع");
            await sb.from("app_kv").delete().eq("key", key);
            return "تمام — التحديث التاني (بنسخة قديمة) اترفض";
          });
        }
        await step(steps, USE_LOCAL_STORAGE ? "تخزين الصور (ملفات)" : `تخزين الصور (bucket: ${FILES_BUCKET})`, async () => {
          const name = "check.png";
          const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
          await blobPut("healthcheck", name, png, "image/png");
          const back = await blobGet("healthcheck", name);
          const exists = await blobExists("healthcheck", name);
          await blobRemove("healthcheck", [name]);
          if (!back || !back.equals(png)) throw new Error("الملف اللي اترفع مش هو اللي اترجع");
          if (!exists) throw new Error("الملف اتحفظ بس مش ظاهر في القايمة");
          return "رفع وقراءة وحذف — تمام";
        });
        if (!USE_LOCAL_STORAGE) {
          await step(steps, "bucket «media» (صور الأقسام والعناصر)", async () => {
            const { data, error } = await getSupabase().storage.getBucket("media");
            if (error || !data) throw new Error("الـ bucket مش موجود");
            if (!data.public) throw new Error("الـ bucket موجود بس مش Public");
            return "موجود وPublic";
          }).then(() => {
            const last = steps[steps.length - 1];
            if (!last.ok) last.hint = "أنشئ bucket اسمه media وخليه Public (Storage ← New bucket). ده بتاع رفع صور الأقسام والعناصر من لوحة التحكم.";
          });
        }
        return json({ info, ok: steps.every((s) => s.ok), steps });
      },
    },
  },
});
