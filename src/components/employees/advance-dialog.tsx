"use client";
import { useEffect, useState } from "react";
import type { Employee } from "@shared/contract";
import { toDateStr } from "@shared/dates";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { formatBaht } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";

/** เบิกเงินล่วงหน้า: recorded now, deducted automatically by the next payslip that covers its date. */
export function AdvanceDialog({ employee, onOpenChange }: { employee: Pick<Employee, "id" | "displayName"> | null; onOpenChange: (o: boolean) => void }) {
  const [date, setDate] = useState(toDateStr(Date.now()));
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (employee) {
      setDate(toDateStr(Date.now()));
      setAmount(null);
      setNote("");
      setError(null);
    }
  }, [employee]);
  const save = useApiMutation(() => api.payroll.createAdvance({ employeeId: employee!.id, date, amount: amount ?? 0, note }), {
    successMessage: (a) => tr("บันทึกเบิกเงิน {0} ของ {1} แล้ว", formatBaht(a.amount), a.employeeName),
    toastError: false,
    onSuccess: () => onOpenChange(false),
    onError: (e) => setError(e.message),
  });
  return (
    <Dialog open={!!employee} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm" data-shot="advance-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!amount || amount <= 0) return setError(tr("กรุณาใส่จำนวนเงิน"));
            save.mutate();
          }}
          noValidate
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{tr("บันทึกเบิกเงินล่วงหน้า — {0}", employee?.displayName)}</DialogTitle>
            <DialogDescription>{tr("ยอดนี้จะถูกหักอัตโนมัติในสลิปเงินเดือนงวดถัดไป")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="adv-amount">{tr("จำนวนเงิน")}</FieldLabel>
              <MoneyInput id="adv-amount" className="h-10 text-base" value={amount} allowEmpty onChange={setAmount} autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="adv-date">{tr("วันที่เบิก")}</FieldLabel>
              <Input id="adv-date" type="date" className="h-10" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="adv-note">{tr("หมายเหตุ")}</FieldLabel>
            <Input id="adv-note" className="h-10" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("เช่น ค่ารักษาพยาบาล")} />
          </Field>
          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {tr("ยกเลิก")}
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null} {tr("บันทึก")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
