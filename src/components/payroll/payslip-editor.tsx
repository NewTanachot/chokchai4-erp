"use client";
import { useQuery } from "@tanstack/react-query";
import { Calculator, CircleCheck, Plus, Printer, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  MANUAL_DEDUCTION_CODES,
  MANUAL_EARNING_CODES,
  PAY_ITEM_KIND,
  PAY_ITEM_LABELS,
  PAY_METHOD_LABELS,
  type PayItemCode,
  type Payslip,
  type PayslipItem,
} from "@shared/contract";
import { payslipTotals } from "@shared/payroll";
import { StatsTiles } from "@/components/attendance/stats";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { payRateText } from "@/components/employees/employee-utils";
import { MoneyInput } from "@/components/money-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatBaht, formatDateStr, formatDateTime } from "@/lib/format";
import { LOCALE, tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

type Line = Omit<PayslipItem, "id"> & { key: string };

let seq = 0;
const toLine = (i: Omit<PayslipItem, "id">): Line => ({ ...i, key: `l${++seq}` });

/** "22 วัน × ฿450.00" / "1.5 ชม. × ฿93.75" breakdown of a calculated line. */
function breakdown(l: Line): string | null {
  if (l.qty === null || l.rate === null) return null;
  const unit = l.code === "ot" ? tr("ชม.") : l.code === "late" && l.label.includes("นาที") ? tr("นาที") : l.code === "late" ? tr("ครั้ง") : tr("วัน");
  return `${l.qty.toLocaleString(LOCALE, { maximumFractionDigits: 2 })} ${unit} × ${formatBaht(Math.round(l.rate))}`;
}

function Lines({
  title,
  lines,
  tone,
  locked,
  onChange,
  onRemove,
  addCodes,
  onAdd,
}: {
  title: string;
  lines: Line[];
  tone: "income" | "expense";
  locked: boolean;
  onChange: (key: string, patch: Partial<Line>) => void;
  onRemove: (key: string) => void;
  addCodes: PayItemCode[];
  onAdd: (code: PayItemCode) => void;
}) {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className={cn("num text-sm font-semibold", tone === "income" ? "text-income" : "text-expense")}>
          {tone === "expense" && total ? "−" : ""}
          {formatBaht(total)}
        </span>
      </div>
      <ul className="divide-y">
        {lines.length === 0 ? <li className="px-3 py-2.5 text-sm text-muted-foreground">{tr("ไม่มีรายการ")}</li> : null}
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              {locked ? (
                <div className="text-sm">{tr(l.label)}</div>
              ) : (
                <Input value={l.label} onChange={(e) => onChange(l.key, { label: e.target.value, auto: false })} className="h-8" aria-label={tr("ชื่อรายการ")} />
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {l.auto ? <Badge variant="outline" className="h-5 px-1.5 text-[11px]">{tr("คำนวณอัตโนมัติ")}</Badge> : <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{tr("แก้ไขเอง")}</Badge>}
                {breakdown(l) ? <span className="num">{breakdown(l)}</span> : null}
              </div>
            </div>
            <div className="w-36 shrink-0">
              {locked ? (
                <div className="num text-right text-sm font-medium">{formatBaht(l.amount)}</div>
              ) : (
                <MoneyInput value={l.amount} onChange={(v) => onChange(l.key, { amount: v ?? 0, auto: false })} className="h-8" aria-label={tr("จำนวนเงิน {0}", l.label)} />
              )}
            </div>
            {!locked ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("ลบ {0}", l.label)} onClick={() => onRemove(l.key)}>
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {!locked ? (
        <div className="border-t px-2 py-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <Plus /> {tone === "income" ? tr("เพิ่มรายได้") : tr("เพิ่มรายการหัก")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {addCodes.map((c) => (
                <DropdownMenuItem key={c} onSelect={() => onAdd(c)}>
                  {PAY_ITEM_LABELS[c]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}

/** View / edit one payslip: calculated + manual lines, recalculate, pay, print. */
export function PayslipEditor({
  payslipId,
  onOpenChange,
  onPay,
  onPrint,
}: {
  payslipId: string | null;
  onOpenChange: (o: boolean) => void;
  onPay: (p: Payslip) => void;
  onPrint: (p: Payslip) => void;
}) {
  // Not refetched on window focus: that would drop unsaved edits. Saves invalidate it as usual.
  const q = useQuery({
    queryKey: ["payroll", "payslip", payslipId],
    queryFn: () => api.payroll.getPayslip(payslipId!),
    enabled: !!payslipId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const p = q.data;
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmUnpay, setConfirmUnpay] = useState(false);

  const reset = (from: Payslip) => {
    setLines(from.items.map(({ id: _id, ...rest }) => toLine(rest)));
    setNote(from.note ?? "");
    setDirty(false);
  };
  // Take the server's version whenever it changes (after save / recalculate / pay).
  useEffect(() => {
    if (p) reset(p);
  }, [p]);

  const locked = p?.status === "paid";
  const totals = payslipTotals(lines);
  const change = (key: string, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const remove = (key: string) => {
    setLines((ls) => ls.filter((l) => l.key !== key));
    setDirty(true);
  };
  const add = (code: PayItemCode) => {
    setLines((ls) => [...ls, toLine({ kind: PAY_ITEM_KIND[code], code, label: PAY_ITEM_LABELS[code], amount: 0, qty: null, rate: null, auto: false })]);
    setDirty(true);
  };

  const save = useApiMutation(
    () =>
      api.payroll.updatePayslip({
        id: p!.id,
        note,
        items: lines.map((l) => ({ code: l.code, label: l.label.trim() || PAY_ITEM_LABELS[l.code], amount: l.amount, qty: l.qty, rate: l.rate, auto: l.auto })),
      }),
    { successMessage: tr("บันทึกสลิปแล้ว") },
  );
  const recalc = useApiMutation(() => api.payroll.recalculate(p!.id), { successMessage: tr("คำนวณใหม่แล้ว") });
  const unpay = useApiMutation(() => api.payroll.unpay(p!.id), { successMessage: tr("ยกเลิกการจ่ายแล้ว — แก้ไขสลิปได้อีกครั้ง") });
  const busy = save.isPending || recalc.isPending || unpay.isPending;

  return (
    <Dialog open={!!payslipId} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl" data-shot="payslip-editor">
        <DialogHeader>
          <DialogTitle className="text-lg">{tr("สลิปเงินเดือน — {0}", p?.employeeName ?? "…")}</DialogTitle>
          <DialogDescription>
            {p ? (
              <>
                {p.runTitle} ({formatDateStr(p.periodStart)} – {formatDateStr(p.periodEnd)}) · {payRateText(p.payType, p.payRate)}
                {p.position ? ` · ${p.position}` : ""}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {!p ? (
          <Skeleton className="h-80" />
        ) : (
          <div className="-mx-4 space-y-4 overflow-y-auto px-4 pb-1">
            {locked ? (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
                <CircleCheck className="size-4 text-success" />
                {tr("จ่ายแล้วเมื่อ {0} น. · {1}{2}", p.paidAt ? formatDateTime(p.paidAt) : "—", p.paymentMethod ? PAY_METHOD_LABELS[p.paymentMethod] : "", p.paidByName ? tr(" · บันทึกโดย {0}", p.paidByName) : "")}
              </div>
            ) : null}
            <StatsTiles stats={p.stats} />
            <div className="grid gap-3 md:grid-cols-2">
              <Lines
                title={tr("รายได้")}
                tone="income"
                lines={lines.filter((l) => l.kind === "earning")}
                locked={locked}
                onChange={change}
                onRemove={remove}
                addCodes={MANUAL_EARNING_CODES}
                onAdd={add}
              />
              <Lines
                title={tr("รายการหัก")}
                tone="expense"
                lines={lines.filter((l) => l.kind === "deduction")}
                locked={locked}
                onChange={change}
                onRemove={remove}
                addCodes={MANUAL_DEDUCTION_CODES}
                onAdd={add}
              />
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3">
              <div className="text-sm text-muted-foreground">
                {tr("รายได้")} <span className="num text-foreground">{formatBaht(totals.earnings)}</span> {tr("− หัก")} <span className="num text-foreground">{formatBaht(totals.deductions)}</span>
                {p.bankAccount ? (
                  <div className="mt-0.5">
                    {tr("โอนเข้า {0} {1}", p.bankName ?? "", p.bankAccount)}
                  </div>
                ) : null}
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">{tr("รับสุทธิ")}</div>
                <div className={cn("num text-3xl leading-none font-bold", totals.net < 0 && "text-destructive")} data-shot="payslip-net">
                  {formatBaht(totals.net)}
                </div>
              </div>
            </div>
            {totals.net < 0 ? <p className="text-sm text-destructive">{tr("ยอดหักมากกว่ารายได้ — ตรวจสอบเงินเบิกล่วงหน้า หรือแบ่งหักในงวดถัดไป")}</p> : null}
            <div>
              <label htmlFor="ps-note" className="text-sm font-medium">
                {tr("หมายเหตุในสลิป")}
              </label>
              <Textarea
                id="ps-note"
                className="mt-1.5 min-h-14"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setDirty(true);
                }}
                disabled={locked}
              />
            </div>
          </div>
        )}
        <DialogFooter className="flex-wrap items-center gap-2">
          {p && !locked ? (
            <Button variant="ghost" className="mr-auto" onClick={() => recalc.mutate()} disabled={busy} title={tr("อ่านเวลาทำงาน วันลา และเงินเบิกล่าสุด แล้วคำนวณรายการอัตโนมัติใหม่ (รายการที่แก้ไขเองจะคงไว้)")}>
              {recalc.isPending ? <Spinner /> : <Calculator />} {tr("คำนวณใหม่")}
            </Button>
          ) : null}
          {p && locked ? (
            <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={() => setConfirmUnpay(true)} disabled={busy}>
              <Undo2 /> {tr("ยกเลิกการจ่าย")}
            </Button>
          ) : null}
          {p ? (
            <Button variant="outline" size="lg" onClick={() => onPrint(p)} disabled={dirty}>
              <Printer /> {tr("พิมพ์สลิป")}
            </Button>
          ) : null}
          {p && !locked ? (
            dirty ? (
              <>
                <Button variant="outline" size="lg" onClick={() => reset(p)} disabled={busy}>
                  <RotateCcw /> {tr("ยกเลิกการแก้ไข")}
                </Button>
                <Button size="lg" onClick={() => save.mutate()} disabled={busy} data-shot="payslip-save">
                  {save.isPending ? <Spinner /> : null} {tr("บันทึกสลิป")}
                </Button>
              </>
            ) : (
              <Button size="lg" className="bg-success text-success-foreground hover:bg-success/85" onClick={() => onPay(p)} disabled={busy} data-shot="payslip-pay">
                <CircleCheck /> {tr("บันทึกจ่ายเงิน")}
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmUnpay}
        onOpenChange={setConfirmUnpay}
        title={tr("ยกเลิกการจ่ายเงินของสลิปนี้?")}
        description={tr("สลิปจะกลับเป็น “ยังไม่จ่าย” เพื่อแก้ไขได้ ประวัติการจ่ายและการยกเลิกจะถูกบันทึกไว้")}
        confirmText={tr("ยกเลิกการจ่าย")}
        destructive
        onConfirm={() => unpay.mutate()}
      />
    </Dialog>
  );
}
