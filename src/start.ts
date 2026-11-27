import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const STATIC_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i;

// «تعطيل الموقع»: لو متفعّل، أي طلب من غير كوكي المطوّر بيشوف صفحة التعطيل بس (والباقي بيتحوّل للرئيسية).
const lockMiddleware = createMiddleware().server(async ({ request, pathname, handlerType, next }) => {
  const { isSiteLocked, hasDevAccess, renderLockPage } = await import("./lib/site-lock.server");
  if (STATIC_RE.test(pathname) || pathname === "/api/site-unlock" || !(await isSiteLocked())) return next();
  if (await hasDevAccess(request.headers.get("cookie"))) return next();
  if (handlerType === "serverFn" || pathname.startsWith("/api/") || request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Website paused" }), { status: 503, headers: { "content-type": "application/json" } });
  }
  if (pathname !== "/") return new Response(null, { status: 302, headers: { location: "/" } });
  return new Response(renderLockPage(), { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "3600" } });
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [lockMiddleware, errorMiddleware],
}));
