// بيعرّف الزائر الحالي (لو مسجل دخول) — بيستخدمه نظام "استثناء كلمة السر" في الصفحات العامة.
import { getCookie } from "@tanstack/react-start/server";
import * as auth from "./local-auth.server";
import type { Viewer } from "./bypass";

export async function getViewer(): Promise<Viewer> {
  try {
    const uid = await auth.verifySessionToken(getCookie(auth.SESSION_COOKIE));
    if (!uid) return null;
    const u = await auth.getUserById(uid);
    if (!u || u.status !== "active") return null;
    return { id: u.id, owner: auth.isOwner(u), rank_ids: u.rank_ids ?? [] };
  } catch {
    return null;
  }
}
