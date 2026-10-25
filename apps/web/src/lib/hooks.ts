import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { DevelopmentDto, Page } from "@easytenant/shared";
import { api } from "./api";

/** Cursor-paginated list as one flat array plus "show more". */
export function usePaged<T>(key: unknown[], path: string, enabled = true) {
  const q = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: "",
    queryFn: ({ pageParam }) => api<Page<T>>(`${path}${path.includes("?") ? "&" : "?"}${pageParam ? `cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return {
    ...q,
    items: q.data?.pages.flatMap((p) => p.items) ?? [],
  };
}

export function useDevelopments() {
  return useQuery({
    queryKey: ["developments", "all"],
    queryFn: () => api<Page<DevelopmentDto>>("/api/developments?limit=100"),
    select: (p) => p.items,
    staleTime: 60_000,
  });
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
