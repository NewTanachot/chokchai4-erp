"use client";
/**
 * React Query helpers.
 *
 * Conventions:
 * - Query keys start with the API namespace: ["products", "list", query], ["transactions", "get", id]...
 * - Every mutation invalidates ALL queries on success (a local SQLite DB is fast, and a sale touches
 *   stock, reports and customers at once - this keeps every screen consistent without bookkeeping).
 */
import { QueryClient, useMutation, useQueryClient, type UseMutationOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "./api";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: false },
      mutations: { retry: false },
    },
  });
}

export function useApiMutation<TData, TVars = void>(
  fn: (vars: TVars) => Promise<TData>,
  opts: {
    /** Toast shown on success (string or builder). */
    successMessage?: string | ((data: TData) => string);
    /** Set false to handle errors yourself (default: toast the error). */
    toastError?: boolean;
  } & Omit<UseMutationOptions<TData, Error, TVars>, "mutationFn"> = {},
) {
  const qc = useQueryClient();
  const { successMessage, toastError = true, onSuccess, onError, ...rest } = opts;
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    ...rest,
    onSuccess: async (data, vars, onMutateResult, ctx) => {
      await qc.invalidateQueries();
      if (successMessage) toast.success(typeof successMessage === "function" ? successMessage(data) : successMessage);
      await onSuccess?.(data, vars, onMutateResult, ctx);
    },
    onError: (err, vars, onMutateResult, ctx) => {
      if (toastError) toast.error(errorMessage(err));
      onError?.(err, vars, onMutateResult, ctx);
    },
  });
}
