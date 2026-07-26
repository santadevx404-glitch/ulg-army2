import { queryOptions } from "@tanstack/react-query";
import {
  sectionsFn,
  sectionsAdminFn,
  sectionBySlugFn,
  itemByIdFn,
  itemsAdminFn,
  topicsByItemFn,
  topicsByItemAdminFn,
} from "@/lib/server-fns";
import type { Section, PublicSection, Item, PublicItem, Topic } from "@/lib/local-store.server";

export type { Section, PublicSection, Item, PublicItem, Topic };

export const sectionsQuery = queryOptions({
  queryKey: ["sections"],
  queryFn: (): Promise<PublicSection[]> => sectionsFn(),
});

export const allSectionsAdminQuery = queryOptions({
  queryKey: ["sections", "admin"],
  queryFn: (): Promise<Section[]> => sectionsAdminFn(),
});

export const sectionBySlugQuery = (slug: string) =>
  queryOptions({
    queryKey: ["section", slug],
    queryFn: () => sectionBySlugFn({ data: slug }),
  });

export const itemByIdQuery = (id: string, password?: string) =>
  queryOptions({
    queryKey: ["item", id, password ?? null],
    queryFn: () => itemByIdFn({ data: { id, password } }),
  });

export const adminItemsQuery = queryOptions({
  queryKey: ["items", "admin"],
  queryFn: (): Promise<Item[]> => itemsAdminFn(),
});

export const topicsByItemQuery = (itemId: string, password?: string) =>
  queryOptions({
    queryKey: ["topics", itemId, password ?? null],
    queryFn: (): Promise<Topic[]> => topicsByItemFn({ data: { itemId, password } }),
    enabled: !!itemId,
  });

export const topicsByItemAdminQuery = (itemId: string) =>
  queryOptions({
    queryKey: ["topics", "admin", itemId],
    queryFn: (): Promise<Topic[]> => topicsByItemAdminFn({ data: itemId }),
    enabled: !!itemId,
  });
