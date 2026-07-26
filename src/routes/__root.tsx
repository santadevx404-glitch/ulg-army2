import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { MotionConfig } from "framer-motion";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { PerformanceModeProvider, usePerformanceMode } from "@/lib/performance-mode";
import { useContentProtection } from "@/lib/content-protection";
import { Sidebar } from "@/components/Sidebar";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { Footer } from "@/components/Footer";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 relative">
      <div className="max-w-md text-center relative z-10">
        <h1 className="text-8xl font-bold gold-text">404</h1>
        <h2 className="mt-4 text-xl font-semibold">الصفحة غير موجودة</h2>
        <p className="mt-2 text-sm text-muted-foreground">لم نعثر على الصفحة المطلوبة.</p>
        <Link to="/" className="btn-gold inline-block mt-6 ripple">العودة للرئيسية</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">حدث خطأ ما</h1>
        <p className="mt-2 text-sm text-muted-foreground">تعذر تحميل هذه الصفحة.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="btn-gold ripple">إعادة المحاولة</button>
          <Link to="/" className="px-4 py-2 rounded-md border border-border">الرئيسية</Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "الرئيسية — موقع حرس الحدود" },
      { name: "description", content: "مرحبًا بك في موقع حرس الحدود الرسمي." },
      { property: "og:title", content: "الرئيسية — موقع حرس الحدود" },
      { property: "og:description", content: "مرحبًا بك في موقع حرس الحدود الرسمي." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "الرئيسية — موقع حرس الحدود" },
      { name: "twitter:description", content: "مرحبًا بك في موقع حرس الحدود الرسمي." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1a8d549c-b836-44c4-9b51-210384bd42c2/id-preview-6f7ea96d--acfca38e-dea0-4ab1-bb35-132f8d2025b8.lovable.app-1784769808299.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1a8d549c-b836-44c4-9b51-210384bd42c2/id-preview-6f7ea96d--acfca38e-dea0-4ab1-bb35-132f8d2025b8.lovable.app-1784769808299.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Tajawal:wght@400;700;900&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <PerformanceModeProvider>
      <QueryClientProvider client={queryClient}>
        <RootContent />
      </QueryClientProvider>
    </PerformanceModeProvider>
  );
}

function RootContent() {
  const { lite } = usePerformanceMode();
  useContentProtection();
  return (
    <MotionConfig reducedMotion={lite ? "always" : "user"}>
      <AnimatedBackground />
      <Sidebar />
      <main className="lg:mr-72 min-h-screen relative z-10 flex flex-col">
        <div className="flex-1">
          <Outlet />
        </div>
        <Footer />
      </main>
      <Toaster position="top-center" richColors theme="dark" />
    </MotionConfig>
  );
}
