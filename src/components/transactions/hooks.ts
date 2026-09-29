"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type TransactionType } from "@shared/contract";
import { api } from "@/lib/api";

/** Value that settles `ms` after the last change. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** App settings (falls back to defaults while loading). */
export function useSettings() {
  const q = useQuery({ queryKey: ["settings", "get"], queryFn: () => api.settings.get(), staleTime: 60_000 });
  return { settings: q.data ?? DEFAULT_SETTINGS, loaded: q.isSuccess };
}

/** Global keyboard shortcut. `combo` examples: "F2", "mod+s", "Escape". */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split("+");
    const key = parts.pop()!;
    const mod = parts.includes("mod");
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key) return;
      if (mod !== (e.metaKey || e.ctrlKey)) return;
      ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, enabled]);
}

/** Current time, refreshed every `ms` (for "now" labels). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Local year-month of a moment, e.g. "2026-08" (doc numbers run per month). */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Preview of the next document number for a bill dated `occurredAt` (null = now), not reserved.
 * The number runs per month of the BILL DATE, so the month is part of the query key.
 */
export function useNextDocNo(type: TransactionType, occurredAt: number | null, opts: { enabled?: boolean; staleTime?: number } = {}): string | undefined {
  const now = useNow(60_000);
  const q = useQuery({
    queryKey: ["transactions", "nextDocNo", type, monthKey(occurredAt ?? now)],
    queryFn: () => api.transactions.nextDocNo({ type, occurredAt }),
    enabled: opts.enabled ?? true,
    staleTime: opts.staleTime,
  });
  return q.data;
}
