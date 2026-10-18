// npm start — بيبني المشروع لسيرفر Node (من غير ما يغيّر vite.config.ts) وبعدين يشغّله.
// يشتغل على Windows / Linux / Mac. تشغيل سريع من غير إعادة بناء: npm start -- --no-build
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root); // مجلد data/ و public/uploads/ نسبيين لجذر المشروع
const entry = path.join(root, ".output", "server", "index.mjs");
const skipBuild = process.argv.includes("--no-build") && existsSync(entry);

if (!skipBuild) {
  console.log("▶ جاري بناء المشروع (أول مرة بياخد شوية)...");
  const require = createRequire(import.meta.url);
  const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
  const r = spawnSync(process.execPath, [viteBin, "build"], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, NITRO_PRESET: "node-server" },
  });
  if (r.status !== 0) {
    console.error("✖ فشل البناء");
    process.exit(r.status ?? 1);
  }
}

const port = process.env.PORT || "3000";
console.log(`▶ تشغيل السيرفر على http://localhost:${port}`);
const child = spawn(process.execPath, [entry], {
  stdio: "inherit",
  cwd: root,
  env: { ...process.env, PORT: port, NITRO_PORT: port },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
