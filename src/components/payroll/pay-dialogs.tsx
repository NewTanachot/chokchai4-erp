"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Banknote, CircleCheck, FileDown, Printer, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PaperSize, PayMethod, Payslip } from "@shared/contract";
import { toDateTimeInput, fromDateTimeInput, formatBaht } from "@/lib/format";
import { ChoiceCard, OptionGroup, PAPER_CARD, PAPER_GLYPH, PrinterSelect, PrintPreview } from "@/components/print/print-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

const METHODS: { value: PayMethod; label: string; icon: typeof Banknote }[] = [
  { value: "transfer", label: tr("โอนเงิน"), icon: Smartphone },
  { value: "cash", label: tr("เงินสด"), icon: Banknote },
];

/** Marks one or more payslips paid (method + time). */
export function PayDialog({ payslips, onOpenChange }: { payslips: Payslip[] | null; onOpenChange: (o: boolean) => void }) {
  const [method, setMethod] = useState<PayMethod>("transfer");
  const [at, setAt] = useState(toDateTimeInput(Date.now()));
  useEffect(() => {
    if (payslips) setAt(toDateTimeInput(Date.now()));
  }, [payslips]);
  const total = (payslips ?? []).reduce((s, p) => s + p.net, 0);
  const pay = useApiMutation(() => api.payroll.pay({ ids: payslips!.map((p) => p.id), paymentMethod: method, paidAt: fromDateTimeInput(at) }), {
    successMessage: (r) => tr("บันทึกจ่ายเงินเดือนแล้ว {0} คน", r.length),
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={!!payslips} onOpenChange={(o) => !pay.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-shot="pay-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{tr("บันทึกจ่ายเงินเดือน")}</DialogTitle>
            <DialogDescription>
              {payslips?.length === 1 ? payslips[0].employeeName : tr("{0} คน", payslips?.length ?? 0)} · {payslips?.[0]?.runTitle}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-baseline justify-between rounded-lg bg-muted/60 px-4 py-3">
            <span className="text-sm text-muted-foreground">{tr("ยอดจ่ายรวม")}</span>
            <span className="num text-2xl font-bold">{formatBaht(total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={tr("จ่ายโดย")}>
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={method === m.value}
                onClick={() => setMethod(m.value)}
                className={cn(
                  "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors hover:bg-muted/50",
                  method === m.value && "border-primary/50 bg-primary/5 ring-1 ring-primary/30",
                )}
              >
                <m.icon className="size-4" /> {m.label}
              </button>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor="pay-at">{tr("วันเวลาที่จ่าย")}</FieldLabel>
            <Input id="pay-at" type="datetime-local" className="h-10" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
              {tr("ยกเลิก")}
            </Button>
            <Button type="submit" size="lg" className="bg-success text-success-foreground hover:bg-success/85" disabled={pay.isPending} autoFocus data-shot="pay-confirm">
              {pay.isPending ? <Spinner /> : <CircleCheck />} {tr("ยืนยันจ่ายแล้ว")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PAPERS: PaperSize[] = ["80mm", "58mm", "a5", "a4"];

/** Preview + print / PDF of one payslip. */
export function PayslipPrintDialog({ payslip, onOpenChange }: { payslip: Payslip | null; onOpenChange: (o: boolean) => void }) {
  const settingsQ = useQuery({ queryKey: ["settings", "get"], queryFn: () => api.settings.get() });
  const printersQ = useQuery({ queryKey: ["print", "printers"], queryFn: () => api.print.printers(), staleTime: 60_000, enabled: !!payslip });
  const [paper, setPaper] = useState<PaperSize | null>(null);
  const [printer, setPrinter] = useState<string | null>(null);
  useEffect(() => {
    if (payslip) {
      setPaper(null);
      setPrinter(null);
    }
  }, [payslip]);
  const defaults = settingsQ.data?.print;
  const chosenPaper: PaperSize = paper ?? (defaults?.defaultPaper === "a4" ? "a4" : "a5");
  const printerName = printer ?? defaults?.printerName ?? "";

  const printM = useMutation({
    mutationFn: () => api.print.printPayslip({ payslipId: payslip!.id, paper: chosenPaper, printerName }),
    onSuccess: (r) => {
      if (r.printed) {
        toast.success(tr("ส่งสลิปไปที่เครื่องพิมพ์แล้ว"));
        onOpenChange(false);
      } else if (r.error === "ยกเลิกการพิมพ์") toast.info(tr("ยกเลิกการพิมพ์"));
      else toast.error(r.error ? tr(r.error) : tr("พิมพ์ไม่สำเร็จ"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pdfM = useMutation({
    mutationFn: () => api.print.savePayslipPdf({ payslipId: payslip!.id, paper: chosenPaper }),
    onSuccess: (r) => {
      if (r) toast.success(tr("บันทึกไฟล์ PDF แล้ว"), { description: r.path.split(/[\\/]/).pop() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const busy = printM.isPending || pdfM.isPending;

  return (
    <Dialog open={!!payslip} onOpenChange={onOpenChange}>
      {payslip ? (
        <DialogContent className="flex h-[min(760px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(900px,calc(100%-2rem))]" data-shot="payslip-print">
          <DialogHeader className="border-b px-5 pt-4 pb-3.5">
            <DialogTitle className="text-lg">{tr("พิมพ์สลิปเงินเดือน")}</DialogTitle>
            <DialogDescription>
              {payslip.employeeName} · {payslip.runTitle}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1">
            <PrintPreview src={`/print/payslip/?id=${encodeURIComponent(payslip.id)}&paper=${chosenPaper}&lang=${defaults?.documentLanguage ?? "th"}`} paper={chosenPaper} />
            <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l px-4 py-4">
              <OptionGroup label={tr("ขนาดกระดาษ")}>
                <RadioGroup value={chosenPaper} onValueChange={(v) => setPaper(v as PaperSize)} className="grid-cols-2 gap-2">
                  {PAPERS.map((p) => (
                    <ChoiceCard key={p} id={`slip-paper-${p}`} value={p} active={chosenPaper === p} compact>
                      <span className="flex h-7 w-5 shrink-0 items-end justify-center">
                        <span className={cn("rounded-xs border-[1.5px] bg-background", chosenPaper === p ? "border-primary" : "border-muted-foreground/45")} style={{ width: PAPER_GLYPH[p].w, height: PAPER_GLYPH[p].h }} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm leading-snug font-medium">{PAPER_CARD[p][0]}</span>
                        <span className="block truncate text-xs leading-snug text-muted-foreground">{PAPER_CARD[p][1]}</span>
                      </span>
                    </ChoiceCard>
                  ))}
                </RadioGroup>
              </OptionGroup>
              <OptionGroup label={tr("เครื่องพิมพ์")}>
                <PrinterSelect value={printerName} onChange={setPrinter} query={printersQ} hint={tr("กด “พิมพ์” แล้วจะมีหน้าต่างพิมพ์ของระบบให้ตรวจสอบอีกครั้ง")} />
              </OptionGroup>
            </aside>
          </div>
          <DialogFooter className="m-0 items-center rounded-b-xl px-5 py-3.5">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)}>
              {tr("ปิด")}
            </Button>
            <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => pdfM.mutate()}>
              {pdfM.isPending ? <Spinner /> : <FileDown />} {tr("บันทึกเป็น PDF")}
            </Button>
            <Button type="button" size="lg" className="min-w-28" disabled={busy} onClick={() => printM.mutate()}>
              {printM.isPending ? <Spinner /> : <Printer />} {tr("พิมพ์")}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
