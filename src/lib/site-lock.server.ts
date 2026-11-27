// «تعطيل الموقع»: مفتاح طوارئ لصاحب الموقع. لما يتفعّل الموقع كله بيقف ومحدش يدخل غير بكود المطوّر.
import crypto from "node:crypto";
import { kvGetJSON, kvSetJSON } from "./kv-store.server";
import { signValue, verifySigned } from "./local-auth.server";

const KEY = "bwd:site-lock";
export const DEV_COOKIE = "bwd_dev";
export const DEV_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const PURPOSE = "site-dev";

type LockDoc = { enabled: boolean; salt: string; hash: string; updated_at: string | null };
const EMPTY: LockDoc = { enabled: false, salt: "", hash: "", updated_at: null };

let cache: { at: number; doc: LockDoc } | null = null;

async function read(): Promise<LockDoc> {
  if (cache && Date.now() - cache.at < 3000) return cache.doc;
  const doc = { ...EMPTY, ...(await kvGetJSON<Partial<LockDoc>>(KEY, {})) };
  cache = { at: Date.now(), doc };
  return doc;
}

const hashCode = (code: string, salt: string) => crypto.scryptSync(code, salt, 32).toString("hex");

export async function isSiteLocked(): Promise<boolean> {
  const d = await read();
  return d.enabled && !!d.hash;
}

export async function siteLockInfo(): Promise<{ enabled: boolean; hasCode: boolean; updated_at: string | null }> {
  cache = null;
  const d = await read();
  return { enabled: d.enabled && !!d.hash, hasCode: !!d.hash, updated_at: d.updated_at };
}

/** تحديث الحالة: code اختياري (كود جديد)؛ التفعيل محتاج كود موجود. */
export async function setSiteLock(enabled: boolean, code?: string): Promise<void> {
  const d = { ...(await read()) };
  const c = String(code ?? "").trim();
  if (c) {
    if (c.length < 4) throw new Error("كود المطوّر لازم يكون 4 حروف على الأقل");
    d.salt = crypto.randomBytes(16).toString("hex");
    d.hash = hashCode(c, d.salt);
  }
  if (enabled && !d.hash) throw new Error("حدّد كود المطوّر الأول");
  d.enabled = enabled;
  d.updated_at = new Date().toISOString();
  await kvSetJSON(KEY, d);
  cache = null;
}

// حماية من التخمين
const fails: number[] = [];

export async function checkDevCode(code: string): Promise<{ ok: boolean; limited?: boolean }> {
  const now = Date.now();
  while (fails.length && now - fails[0] > 60_000) fails.shift();
  if (fails.length >= 10) return { ok: false, limited: true };
  const d = await read();
  const c = String(code ?? "").trim();
  if (!d.hash || !c) { fails.push(now); return { ok: false }; }
  const a = Buffer.from(hashCode(c, d.salt), "hex");
  const b = Buffer.from(d.hash, "hex");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) fails.push(now);
  return { ok };
}

export const makeDevToken = () => signValue(PURPOSE, "dev", DEV_COOKIE_MAX_AGE);

export async function hasDevAccess(cookieHeader: string | null): Promise<boolean> {
  const m = (cookieHeader ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${DEV_COOKIE}=`));
  if (!m) return false;
  return (await verifySigned(PURPOSE, decodeURIComponent(m.slice(DEV_COOKIE.length + 1)))) === "dev";
}

export function renderLockPage(): string {
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Website Hes Broken</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 20%,#1b1608 0%,#0a0a0a 60%);color:#f3ecd4;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
  .box{width:100%;max-width:460px;text-align:center}
  svg{width:150px;height:auto;filter:drop-shadow(0 6px 22px rgba(245,197,24,.25))}
  h1{margin:18px 0 6px;font-size:30px;letter-spacing:.5px;color:#f5c518}
  .sub{margin:0 0 30px;color:#b9b19a;font-size:14px}
  label{display:block;font-weight:700;margin-bottom:8px;letter-spacing:.5px}
  input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #4a4126;background:#15130c;color:#fff;font-size:16px;text-align:center;outline:none}
  input:focus{border-color:#f5c518}
  button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:10px;background:#f5c518;color:#1a1400;font-weight:800;font-size:15px;cursor:pointer}
  button:disabled{opacity:.6;cursor:default}
  .err{min-height:22px;margin-top:10px;color:#ff6b6b;font-size:14px}
</style>
</head>
<body>
<div class="box">
  <svg viewBox="0 0 120 140" aria-label="Broken shield">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd84d"/><stop offset="1" stop-color="#b8860b"/></linearGradient>
      <clipPath id="l"><path d="M0 0H62L55 22L68 38L52 58L66 78L54 100L60 140H0Z"/></clipPath>
      <clipPath id="r"><path d="M62 0H120V140H60L54 100L66 78L52 58L68 38L55 22Z"/></clipPath>
    </defs>
    <g clip-path="url(#l)" transform="translate(-5 3) rotate(-5 40 70)">
      <path d="M60 6L12 22V66C12 98 32 122 60 134C88 122 108 98 108 66V22Z" fill="url(#g)" stroke="#6b4e00" stroke-width="4" stroke-linejoin="round"/>
      <path d="M60 24L28 35V66C28 88 42 105 60 114Z" fill="none" stroke="#6b4e00" stroke-width="3" opacity=".55"/>
    </g>
    <g clip-path="url(#r)" transform="translate(6 7) rotate(6 80 70)">
      <path d="M60 6L12 22V66C12 98 32 122 60 134C88 122 108 98 108 66V22Z" fill="url(#g)" stroke="#6b4e00" stroke-width="4" stroke-linejoin="round"/>
      <path d="M60 24L92 35V66C92 88 78 105 60 114Z" fill="none" stroke="#6b4e00" stroke-width="3" opacity=".55"/>
    </g>
  </svg>
  <h1>Website Hes Broken</h1>
  <p class="sub">Website Paused By WebSite Developer - Discord : mjy88</p>
  <form id="f" autocomplete="off">
    <label for="c">Developer Code</label>
    <input id="c" type="password" placeholder="Enter code" autocomplete="off" />
    <button id="b" type="submit">Enter</button>
    <div class="err" id="e"></div>
  </form>
</div>
<script>
  var f=document.getElementById('f'),c=document.getElementById('c'),b=document.getElementById('b'),e=document.getElementById('e');
  f.addEventListener('submit',function(ev){
    ev.preventDefault(); e.textContent=''; b.disabled=true;
    fetch('/api/site-unlock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:c.value})})
      .then(function(r){return r.json().catch(function(){return {}})})
      .then(function(j){ if(j.ok){location.href='/';location.reload();} else {e.textContent=j.limited?'Too many attempts, wait a minute.':'Wrong code.';b.disabled=false;} })
      .catch(function(){e.textContent='Network error.';b.disabled=false;});
  });
</script>
</body>
</html>`;
}
