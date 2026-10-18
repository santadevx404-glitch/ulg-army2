import { useEffect } from "react";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // حقول الاختبار (data-no-clipboard) مش مستثناة: النسخ واللصق ممنوعين فيها
  if (target.closest("[data-no-clipboard]")) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

// لوحة التحكم (المطور) مفيهاش أي منع للنسخ
function isAdminPage(): boolean {
  return typeof location !== "undefined" && location.pathname.startsWith("/admin");
}

/**
 * يمنع تحديد النصوص، النسخ/القص، وقائمة الزر اليمين (Right-click) في كل
 * الموقع — عشان يبقى المحتوى للعرض بس. بنستثني حقول الإدخال والـ textarea
 * (زي فورمات لوحة التحكم) عشان تفضل شغالة عادي للكتابة والتعديل.
 *
 * ملحوظة: ده رادع بسيط للزوار العاديين مش حماية مطلقة — أي حد يفهم في
 * أدوات المطورين (DevTools) يقدر يتخطاه.
 */
export function useContentProtection() {
  useEffect(() => {
    const blockContextMenu = (e: MouseEvent) => {
      if (isAdminPage() || isEditableTarget(e.target)) return;
      e.preventDefault();
    };
    const blockCopyCut = (e: ClipboardEvent) => {
      if (isAdminPage() || isEditableTarget(e.target)) return;
      e.preventDefault();
    };
    const blockSelectStart = (e: Event) => {
      if (isAdminPage() || isEditableTarget(e.target)) return;
      e.preventDefault();
    };
    const blockDragStart = (e: DragEvent) => {
      if (isAdminPage() || isEditableTarget(e.target)) return;
      e.preventDefault();
    };
    // اللصق والإفلات: ممنوعين بس جوه حقول الاختبار
    const blockPaste = (e: Event) => {
      if (e.target instanceof HTMLElement && e.target.closest("[data-no-clipboard]")) e.preventDefault();
    };

    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("copy", blockCopyCut);
    document.addEventListener("cut", blockCopyCut);
    document.addEventListener("selectstart", blockSelectStart);
    document.addEventListener("dragstart", blockDragStart);
    document.addEventListener("paste", blockPaste);
    document.addEventListener("drop", blockPaste);

    return () => {
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("copy", blockCopyCut);
      document.removeEventListener("cut", blockCopyCut);
      document.removeEventListener("selectstart", blockSelectStart);
      document.removeEventListener("dragstart", blockDragStart);
      document.removeEventListener("paste", blockPaste);
      document.removeEventListener("drop", blockPaste);
    };
  }, []);
}
