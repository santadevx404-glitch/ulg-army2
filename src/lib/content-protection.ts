import { useEffect } from "react";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
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
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    };
    const blockCopyCut = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    };
    const blockSelectStart = (e: Event) => {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    };
    const blockDragStart = (e: DragEvent) => {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    };

    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("copy", blockCopyCut);
    document.addEventListener("cut", blockCopyCut);
    document.addEventListener("selectstart", blockSelectStart);
    document.addEventListener("dragstart", blockDragStart);

    return () => {
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("copy", blockCopyCut);
      document.removeEventListener("cut", blockCopyCut);
      document.removeEventListener("selectstart", blockSelectStart);
      document.removeEventListener("dragstart", blockDragStart);
    };
  }, []);
}
