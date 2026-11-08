// المستخدم الحالي وصلاحياته في المتصفح (للإظهار والإخفاء بس — السيرفر هو اللي بيفرض الصلاحيات فعليًا).
import { queryOptions, useQuery } from "@tanstack/react-query";
import { currentUserFn } from "@/lib/server-fns";
import { hasAnyPerm, hasAnyPermAt, hasPerm, type Scope } from "@/lib/permissions";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => currentUserFn(),
  staleTime: 15_000,
});

export type Me = NonNullable<Awaited<ReturnType<typeof currentUserFn>>>;

export function useMe() {
  const q = useQuery(meQuery);
  const me = q.data ?? null;
  return {
    me,
    loading: q.isLoading,
    can: (perm: string, scope?: Scope) => !!me && hasPerm(me.perms, me.full, perm, scope),
    canAny: (perm: string) => !!me && hasAnyPerm(me.perms, me.full, perm),
    canAnyAt: (perm: string, scope: Scope) => !!me && hasAnyPermAt(me.perms, me.full, perm, scope),
  };
}
