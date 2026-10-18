#!/usr/bin/env node
// ينقل بياناتك المحلية (مجلد data/) إلى Supabase: صفوف app_kv + الصور في الـ bucket.
//
//   npm run migrate:supabase -- --dry-run      ← يعرض اللي هيتنقل من غير ما ينقل
//   npm run migrate:supabase                   ← ينقل (الصفوف الموجودة قبل كده في Supabase بيتخطاها)
//   npm run migrate:supabase -- --overwrite    ← ينقل ويكتب فوق الصفوف الموجودة
//
// بيقرا SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY من .env. مبيمسحش أي حاجة.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---- .env ----
for (const name of [".env.local", ".env"]) {
  const file = path.resolve(process.cwd(), name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const OVERWRITE = args.has("--overwrite");

const FILES = {
  "db.json": "bwd:db",
  "users.json": "bwd:users",
  "session-secret.txt": "bwd:session-secret",
  "exams.json": "bwd:exams",
  "exam-attempts.json": "bwd:exam-attempts",
  "ranks.json": "bwd:ranks",
  "audit-log.json": "bwd:audit-log",
  "login-log.json": "bwd:login-log",
  "chats.json": "bwd:chats",
  "chat-messages.json": "bwd:chat-messages",
  "chat-uploads.json": "bwd:chat-uploads",
  "announcements.json": "bwd:announcements",
};
const IMAGE_DIRS = ["exam-uploads", "avatars", "chat-images", "announcement-images"];
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const BUCKET = process.env.SUPABASE_FILES_BUCKET || "app-files";
const DATA = path.resolve(process.cwd(), "data");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY ناقصين. حطهم في ملف .env (راجع .env.example).");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { error: probe } = await supabase.from("app_kv").select("key, version").limit(1);
if (probe) {
  console.error("✗ مقدرتش أقرا جدول app_kv:", probe.message);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(probe.message)) console.error("  ← مش قادر يوصل لـ SUPABASE_URL، راجع الرابط في .env واتصالك بالإنترنت.");
  else if (/invalid api key|jwt/i.test(probe.message)) console.error("  ← المفتاح غلط: لازم الـ Secret (service_role) مش الـ Publishable.");
  else console.error("  ← شغّل ملف supabase/setup.sql في Supabase SQL Editor الأول.");
  process.exit(1);
}

console.log(`${DRY ? "[تجربة — مفيش حاجة بتتكتب] " : ""}نقل البيانات من data/ إلى ${new URL(url).host}\n`);

let moved = 0, skipped = 0;
for (const [file, k] of Object.entries(FILES)) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) continue;
  const raw = fs.readFileSync(p, "utf8");
  let value;
  if (file.endsWith(".txt")) value = raw.trim();
  else {
    try { value = JSON.parse(raw); } catch { console.log(`  ⚠ ${file}: مش JSON صالح، اتخطّى`); skipped++; continue; }
  }
  if (value === "" || value === null) { skipped++; continue; }

  const { data: existing, error } = await supabase.from("app_kv").select("version").eq("key", k).maybeSingle();
  if (error) { console.error(`✗ ${k}:`, error.message); process.exit(1); }
  if (existing && !OVERWRITE) { console.log(`  = ${file} → ${k}: موجود في Supabase، اتخطّى (استخدم --overwrite)`); skipped++; continue; }
  const size = Math.round(Buffer.byteLength(JSON.stringify(value)) / 1024);
  console.log(`  ${existing ? "↻" : "+"} ${file} → ${k} (${size} KB)`);
  if (!DRY) {
    const res = existing
      ? await supabase.from("app_kv").update({ value, version: Number(existing.version) + 1 }).eq("key", k).eq("version", existing.version).select("version")
      : await supabase.from("app_kv").insert({ key: k, value, version: 1 });
    if (res.error) { console.error(`✗ ${k}:`, res.error.message); process.exit(1); }
  }
  moved++;
}

let imgs = 0;
for (const dir of IMAGE_DIRS) {
  const d = path.join(DATA, dir);
  if (!fs.existsSync(d)) continue;
  const files = fs.readdirSync(d).filter((f) => /\.(jpg|png|webp|gif)$/.test(f));
  if (files.length === 0) continue;
  console.log(`  🖼 ${dir}/: ${files.length} صورة`);
  if (DRY) { imgs += files.length; continue; }
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists|duplicate|exists/i.test(error.message)) { console.error("✗ bucket:", error.message); process.exit(1); }
  for (const f of files) {
    const buf = fs.readFileSync(path.join(d, f));
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(`${dir}/${f}`, buf, { contentType: MIME[f.split(".").pop()], upsert: true });
    if (upErr) { console.error(`✗ ${dir}/${f}:`, upErr.message); process.exit(1); }
    imgs++;
  }
}

console.log(`\n${DRY ? "هيتنقل" : "اتنقل"}: ${moved} ملف بيانات، ${imgs} صورة. اتخطّى: ${skipped}.`);
if (DRY) console.log("شغّل الأمر من غير --dry-run عشان تنقل فعلًا.");
else console.log("تمام ✓ — شغّل المشروع وافتح لوحة التحكم، وهتلاقي شارة «قاعدة البيانات: Supabase» (دوس عليها للفحص).");
console.log("\nملحوظة: صور الأقسام والعناصر القديمة (اللي في public/) مش محتاجة نقل — بتتنشر مع المشروع.");
