"use client";
/**
 * Printable receipt / invoice / purchase record (outside the app shell).
 * URL: /print/?id=<transactionId>&kind=receipt|invoice|purchase&paper=80mm|58mm|a4|a5&lang=th|en
 *
 * Used by electron/api/print.ts (hidden window -> printer / PDF) and by the PrintDialog preview (iframe);
 * the ready / error handshake is in PrintShell.
 */
import { useQuery } from "@tanstack/react-query";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/api";
import { buildDocModel, parseKind, parsePaper } from "@/components/print/doc-model";
import { PrintDocument } from "@/components/print/print-document";
import { adoptParentBridge, PrintShell } from "@/components/print/print-shell";
import { tr } from "@/lib/i18n";

function PrintView() {
  adoptParentBridge();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const kindParam = parseKind(params.get("kind"));
  const paperParam = parsePaper(params.get("paper"));

  const txQ = useQuery({
    queryKey: ["transactions", "get", id],
    queryFn: () => api.transactions.get(id),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
  const settingsQ = useQuery({ queryKey: ["settings", "get"], queryFn: () => api.settings.get(), refetchOnWindowFocus: false });

  const paper = paperParam ?? settingsQ.data?.print.defaultPaper ?? "80mm";
  const model = useMemo(
    () => (txQ.data && settingsQ.data ? buildDocModel(txQ.data, settingsQ.data, kindParam, paper) : null),
    [txQ.data, settingsQ.data, kindParam, paper],
  );
  const error = !id ? tr("ไม่ได้ระบุรายการที่จะพิมพ์") : txQ.error ? errorMessage(txQ.error) : settingsQ.error ? errorMessage(settingsQ.error) : null;

  return (
    <PrintShell doc={model} paper={paper} error={error}>
      {model ? <PrintDocument model={model} /> : null}
    </PrintShell>
  );
}

export default function PrintPage() {
  return (
    <Suspense fallback={null}>
      <PrintView />
    </Suspense>
  );
}
