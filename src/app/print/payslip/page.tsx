"use client";
/**
 * Printable payslip (outside the app shell). URL: /print/payslip/?id=<payslipId>&paper=80mm|58mm|a4|a5&lang=th|en
 * Printed / saved as PDF by electron/api/print.ts (print.printPayslip / savePayslipPdf); same handshake as /print/.
 */
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { parsePaper } from "@/components/print/doc-model";
import { PAYSLIP_CSS, PayslipDocument } from "@/components/print/payslip-document";
import { adoptParentBridge, PrintShell } from "@/components/print/print-shell";
import { api, errorMessage } from "@/lib/api";
import { tr } from "@/lib/i18n";

function PayslipPrintView() {
  adoptParentBridge();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const paperParam = parsePaper(params.get("paper"));
  const slipQ = useQuery({ queryKey: ["payroll", "payslip", id], queryFn: () => api.payroll.getPayslip(id), enabled: !!id, refetchOnWindowFocus: false });
  const settingsQ = useQuery({ queryKey: ["settings", "get"], queryFn: () => api.settings.get(), refetchOnWindowFocus: false });
  const paper = paperParam ?? settingsQ.data?.print.defaultPaper ?? "a5";
  const doc = useMemo(() => (slipQ.data && settingsQ.data ? { docNo: tr("สลิป {0}", slipQ.data.employeeName), title: slipQ.data.runTitle } : null), [slipQ.data, settingsQ.data]);
  const error = !id ? tr("ไม่ได้ระบุสลิปที่จะพิมพ์") : slipQ.error ? errorMessage(slipQ.error) : settingsQ.error ? errorMessage(settingsQ.error) : null;
  return (
    <PrintShell doc={doc} paper={paper} error={error} extraCss={PAYSLIP_CSS}>
      {slipQ.data && settingsQ.data ? <PayslipDocument payslip={slipQ.data} settings={settingsQ.data} paper={paper} /> : null}
    </PrintShell>
  );
}

export default function PayslipPrintPage() {
  return (
    <Suspense fallback={null}>
      <PayslipPrintView />
    </Suspense>
  );
}
