// أدوات صور في المتصفح: تصغير/ضغط الصورة قبل الرفع.
export async function prepareImage(file: Blob, opts: { maxBytes: number; maxSide?: number; passThroughBelow?: number }): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("نوع الصورة مش مدعوم (JPG / PNG / WEBP / GIF)");
  if (file.size > 25 * 1024 * 1024) throw new Error("الصورة كبيرة جدًا");
  const pass = opts.passThroughBelow ?? 1_500_000;
  if (file.size <= pass && file.size <= opts.maxBytes) return file;
  const bmp = await createImageBitmap(file);
  const side = opts.maxSide ?? 2000;
  const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.5]) {
    const out: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (out && out.size <= opts.maxBytes) return out;
  }
  throw new Error("الصورة أكبر من الحد المسموح حتى بعد الضغط");
}
