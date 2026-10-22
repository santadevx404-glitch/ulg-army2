// بيعرّف الزائر الحالي (لو مسجل دخول) — بيستخدمه نظام "استثناء كلمة السر" في الصفحات العامة.
import { getCookie } from "@tanstack/react-start/server";
import * as auth from "./local-auth.server";
import { actorFromUserId } from "./access.server";
import type { Viewer } from "./bypass";

export async function getViewer(): Promise<Viewer> {
  try {
    const uid = await auth.verifySessionToken(getCookie(auth.SESSION_COOKIE));
    if (!uid) return null;
    const a = await actorFromUserId(uid);
    if (!a) return null;
    return { id: a.user.id, owner: a.full, rank_ids: a.user.rank_ids ?? [] };
  } catch {
    return null;
  }
}
