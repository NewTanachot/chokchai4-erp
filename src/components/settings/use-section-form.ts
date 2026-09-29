"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AppSettings } from "@shared/contract";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";

export const SETTINGS_QUERY_KEY = ["settings", "get"] as const;

export type SectionKey = keyof AppSettings;
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

/** Lets each section report unsaved changes to the page (dots in the sub-navigation). */
export const DirtyContext = createContext<(id: string, dirty: boolean) => void>(() => {});

/**
 * Draft state for one settings section. The draft is stored as a set of edits on top of the saved values,
 * so a background refetch never throws away what the user is typing, and saving clears only this section.
 */
export function useSectionForm<K extends SectionKey>(
  key: K,
  saved: AppSettings[K],
  opts: {
    /** Section id reported to the DirtyContext (defaults to key). */
    id?: string;
    validate?: (v: AppSettings[K]) => FieldErrors<AppSettings[K]>;
    successMessage?: string;
  } = {},
) {
  type V = AppSettings[K];
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Partial<V>>({});
  const [submitted, setSubmitted] = useState(false);

  const value = useMemo(() => ({ ...saved, ...edits }) as V, [saved, edits]);
  // Arrays (e.g. work days) compare by content.
  const differs = (a: unknown, b: unknown) => (typeof a === "object" && a !== null ? JSON.stringify(a) !== JSON.stringify(b) : a !== b);
  const dirty = (Object.keys(edits) as (keyof V)[]).some((k) => differs(edits[k], saved[k]));
  const errors: FieldErrors<V> = opts.validate?.(value) ?? {};
  const hasErrors = Object.values(errors).some(Boolean);

  const reportDirty = useContext(DirtyContext);
  const id = opts.id ?? key;
  useEffect(() => {
    reportDirty(id, dirty);
  }, [reportDirty, id, dirty]);
  useEffect(() => () => reportDirty(id, false), [reportDirty, id]);

  const set = useCallback(<F extends keyof V>(field: F, v: V[F]) => setEdits((e) => ({ ...e, [field]: v })), []);
  const patch = useCallback((p: Partial<V>) => setEdits((e) => ({ ...e, ...p })), []);
  const reset = useCallback(() => {
    setEdits({});
    setSubmitted(false);
  }, []);

  const mutation = useApiMutation(
    async (v: V) => {
      const next = await api.settings.update({ [key]: v } as Parameters<typeof api.settings.update>[0]);
      // Update the cache before invalidation so the form never flashes the old values.
      qc.setQueryData(SETTINGS_QUERY_KEY, next);
      return next;
    },
    {
      successMessage: opts.successMessage ?? tr("บันทึกการตั้งค่าแล้ว"),
      onSuccess: () => {
        setEdits({});
        setSubmitted(false);
      },
    },
  );

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!dirty || mutation.isPending) return;
    setSubmitted(true);
    if (hasErrors) {
      toast.error(tr("กรุณาตรวจสอบข้อมูลที่กรอก"));
      return;
    }
    mutation.mutate(value);
  };

  /** Error for a field: shown once it was edited or after a save attempt. */
  const errorOf = (field: keyof V): string | undefined => (submitted || field in edits ? errors[field] : undefined);

  return { value, set, patch, dirty, reset, submit, saving: mutation.isPending, errorOf, hasErrors };
}

export type SectionForm<K extends SectionKey> = ReturnType<typeof useSectionForm<K>>;
