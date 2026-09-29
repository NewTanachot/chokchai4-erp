"use client";
import { useSearchParams } from "next/navigation";

/**
 * Read a query-string param. The app is a static export (no dynamic [id] routes), so detail pages use
 * `?id=...`. NOTE: any component calling this must be rendered inside <Suspense> (Next.js requirement
 * for useSearchParams in static builds) - wrap your page body: <Suspense><Inner /></Suspense>.
 */
export function useSearchParam(name: string): string | null {
  return useSearchParams().get(name);
}
