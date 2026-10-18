-- ============================================================
-- إعداد Supabase للموقع — شغّل الملف كله مرة واحدة:
-- Supabase Dashboard ← SQL Editor ← New query ← الصق الملف ← Run
-- (آمن تشغّله أكتر من مرة، ومفيش حاجة بتتمسح)
-- ============================================================

-- 1) جدول التخزين الرئيسي: كل بيانات الموقع (الأقسام، الحسابات، الرتب، الاختبارات،
--    الدردشات، الإعلانات، السجلات...) صفوف مفتاح/قيمة JSON.
create table if not exists public.app_kv (
  key        text primary key,
  value      jsonb       not null,
  version    bigint      not null default 1,   -- بيزيد مع كل كتابة (حماية من ضياع الكتابة)
  updated_at timestamptz not null default now()
);

-- لو الجدول كان موجود من نسخة أقدم (من غير version):
alter table public.app_kv add column if not exists version    bigint      not null default 1;
alter table public.app_kv add column if not exists updated_at timestamptz not null default now();

-- تحديث updated_at تلقائي
create or replace function public.app_kv_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_kv_touch on public.app_kv;
create trigger app_kv_touch before update on public.app_kv
  for each row execute function public.app_kv_touch();

-- 2) الأمان: السيرفر بيستخدم الـ Secret (service_role) اللي بيعدّي الـ RLS.
--    بنقفل الجدول على أي مفتاح تاني (anon / publishable) — مفيش policies = محدش يقرا أو يكتب.
alter table public.app_kv enable row level security;

-- 3) تخزين الملفات
--    media     : صور الأقسام والعناصر اللي بتترفع من لوحة التحكم (Public)
--    app-files : صور الدردشة والبروفايل والإعلانات وإجابات الاختبارات (Private — بتتخدم من السيرفر بعد فحص الصلاحيات)
insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do update set public = true;
insert into storage.buckets (id, name, public) values ('app-files', 'app-files', false)
  on conflict (id) do nothing;
