# موقع حرس الحدود

TanStack Start + React + TypeScript. بيانات الموقع بتتخزن في **Supabase** (أو في ملفات لوكال للتطوير).

## وضع التخزين (تلقائي)

| الحالة | الوضع |
|---|---|
| `STORAGE_MODE=supabase` أو `local` محدد في `.env` | اللي حددته |
| شغال على **Vercel** | Supabase دايمًا (مفيش قرص قابل للكتابة) |
| `SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` موجودين | Supabase |
| غير كده | ملفات في مجلد `data/` |

---

## ربط الموقع بـ Supabase (مرة واحدة)

1. **اعمل مشروع** على [supabase.com](https://supabase.com) (مجاني).
2. **شغّل `supabase/setup.sql`**: Supabase ← *SQL Editor* ← *New query* ← الصق محتوى الملف ← *Run*.
   بيعمل جدول `app_kv` (مع عمود `version`)، وبيقفله على أي مفتاح غير الـ Secret، وبيعمل الـ buckets.
   آمن تشغّله أكتر من مرة، ومفيش حاجة بتتمسح.
3. **المفاتيح**: Supabase ← *Settings* ← *API*، وانسخ:
   - **Project URL**
   - **Secret key** (`service_role`) — *مش* الـ Publishable.
4. **اعمل ملف `.env`** في مجلد المشروع (انسخ `.env.example`):
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=الـ_secret_key
   ```
5. **انقل بياناتك الحالية** (لو عندك بيانات في `data/`):
   ```sh
   npm run migrate:supabase -- --dry-run   # يعرض اللي هيتنقل
   npm run migrate:supabase                # ينقل (اللي موجود في Supabase بيتخطاه)
   ```
6. **شغّل المشروع** وسجّل دخول كأدمن أساسي:
   ```sh
   npm install
   npm run dev
   ```
   هتلاقي في لوحة التحكم شارة **«قاعدة البيانات: Supabase»**. دوس عليها للفحص الكامل
   (الجدول، عمود version، حماية التعارض، تخزين الصور، bucket الـ media).

> لو مفيش بيانات تنقلها: افتح `/auth` ← «إنشاء حساب المطور» بإيميل الأدمن الأساسي. (الحساب الجاهز
> `m1172009` بتاع الوضع المحلي بيشتغل في الوضع المحلي بس.)

### على Vercel

*Settings ← Environment Variables* وضيف `SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY`، وبعدين **Redeploy**.
مفيش حاجة تانية. (`npm run migrate:supabase` بتشغّله من جهازك مرة واحدة.)

---

## إيه اللي بيتخزن فين

**جدول `app_kv`** (صف لكل مفتاح، والقيمة JSON):

| المفتاح | المحتوى |
|---|---|
| `bwd:db` | الأقسام والعناصر والمواضيع |
| `bwd:users` | الحسابات (الباسوردات مهشّرة) |
| `bwd:ranks` | الرتب وصلاحياتها وترتيبها |
| `bwd:exams` / `bwd:exam-attempts` | الاختبارات وأسئلتها / محاولات الناس وإجاباتهم |
| `bwd:chats` / `bwd:chat-messages` / `bwd:chat-uploads` | الدردشات / الرسايل / سجل رفع صور الدردشة |
| `bwd:announcements` | الإعلانات |
| `bwd:audit-log` / `bwd:login-log` | سجل نشاط الإدارة / سجل الدخول |
| `bwd:session-secret` | سر توقيع الجلسات (**لا تغيّره** وإلا الكل هيتسجّل خروج) |

**Storage:**

| الـ bucket | المحتوى | الوصول |
|---|---|---|
| `media` (Public) | صور الأقسام والعناصر من لوحة التحكم | رابط عام |
| `app-files` (Private) | `exam-uploads/` `avatars/` `chat-images/` `announcement-images/` | بس من خلال الموقع بعد فحص الصلاحيات |

### حماية التعارض
كل صف ليه `version`. أي كتابة بتتأكد إن محدش غيّر الصف بعد ما قريته، ولو حصل بتعيد العملية من الأول.
ده بيمنع ضياع رسايل الدردشة أو إجابات الاختبار لو سيرفرين (أو شخصين) كتبوا في نفس اللحظة.

### حدود لازم تعرفها
- حجم الصورة **4 ميجا** (حد Vercel لحجم الطلب ~4.5 ميجا)، والمتصفح بيضغط الصور الكبيرة تلقائيًا.
- `bwd:exam-attempts` و `bwd:chat-messages` بيتخزنوا كصف واحد لكل نوع. مناسب لمجموعة خاصة (عشرات الأشخاص).
  لو الاستخدام كبر (مئات بيحلّوا اختبار في نفس الوقت) الأفضل تتحول لجداول مخصصة.
- كل قراءة = طلب لـ Supabase، فالموقع أبطأ شوية من الوضع المحلي.

---

## التشغيل المحلي

```sh
npm install
npm run dev        # http://localhost:8080
```

- من غير `.env`: وضع لوكال (ملفات `data/`)، وحساب المطور الجاهز: `santadevx404@gmail.com` / `m1172009`.
- `npm start` بيبني وبيشغّل نسخة الإنتاج على بورت 3000.

Passwords are hashed with scrypt, never stored in plain text.
