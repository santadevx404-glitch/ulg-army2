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
<<<<<<< HEAD
    return { id: a.user.id, owner: a.full || a.perms.has("bypass_all"), rank_ids: a.user.rank_ids ?? [] };
=======
    return { id: a.user.id, owner: a.full, rank_ids: a.user.rank_ids ?? [] };
>>>>>>> 5138264ed8cbd73abbf275424cb543060a08c742
  } catch {
    return null;
  }
}
