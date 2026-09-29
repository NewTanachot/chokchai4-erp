"use client";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { addDays, endOfMonth, isDateStr, startOfMonth, toDateStr } from "@shared/dates";
import { payrollTitle } from "@shared/payroll";
import { payRateText } from "@/components/employees/employee-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { lang, tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

type Preset = "this" | "last" | "first-half" | "second-half" | "custom";

function presetPeriod(p: Preset): { from: string; to: string } | null {
  const today = toDateStr(Date.now());
  const thisMonth = startOfMonth(today);
  if (p === "this") return { from: thisMonth, to: endOfMonth(today) };
  if (p === "last") {
    const lastEnd = addDays(thisMonth, -1);
    return { from: startOfMonth(lastEnd), to: lastEnd };
  }
  if (p === "first-half") return { from: thisMonth, to: addDays(thisMonth, 14) };
  if (p === "second-half") return { from: addDays(thisMonth, 15), to: endOfMonth(today) };
  return null;
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "last", label: tr("เดือนที่แล้ว") },
  { id: "this", label: tr("เดือนนี้") },
  { id: "first-half", label: tr("1–15 เดือนนี้") },
  { id: "second-half", label: tr("16–สิ้นเดือนนี้") },
  { id: "custom", label: tr("กำหนดเอง") },
];

/** New pay period: pick the dates and who is paid; payslips are calculated right away. */
export function CreateRunDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset>("last");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const day = new Date().getDate();
    const initial: Preset = day >= 25 ? "this" : "last";
    setPreset(initial);
    const p = presetPeriod(initial)!;
    setFrom(p.from);
    setTo(p.to);
    setTitle("");
    setError(null);
  }, [open]);

  const choose = (p: Preset) => {
    setPreset(p);
    const r = presetPeriod(p);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const valid = isDateStr(from) && isDateStr(to) && from <= to;
  const candidates = useQuery({
    queryKey: ["payroll", "candidates", from, to],
    queryFn: () => api.payroll.candidates({ periodStart: from, periodEnd: to }),
    enabled: open && valid,
  });
  const list = useMemo(() => candidates.data ?? [], [candidates.data]);

  // Everyone without a clash is ticked whenever the list changes.
  useEffect(() => {
    setPicked(new Set(list.filter((c) => !c.overlap && c.isActive).map((c) => c.employeeId)));
  }, [list]);

  const create = useApiMutation(() => api.payroll.createRun({ periodStart: from, periodEnd: to, title: title || null, employeeIds: [...picked] }), {
    successMessage: (r) => tr("สร้าง “{0}” แล้ว ({1} คน)", r.title, r.payslipCount),
    toastError: false,
    onSuccess: (r) => {
      onOpenChange(false);
      router.push(`/payroll/view/?id=${r.id}`);
    },
    onError: (e) => setError(e.message),
  });

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl" data-shot="create-run">
        <DialogHeader>
          <DialogTitle className="text-lg">{tr("สร้างงวดเงินเดือน")}</DialogTitle>
          <DialogDescription>{tr("ระบบคำนวณสลิปของแต่ละคนจากค่าจ้าง เวลาทำงาน วันลา และเงินเบิกล่วงหน้าให้ แล้วแก้ไขเพิ่มเติมได้ก่อนจ่ายเงิน")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 space-y-4 overflow-y-auto px-4 pb-1">
          <div>
            <div className="mb-2 text-sm font-medium">{tr("ช่วงเวลาของงวด")}</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => choose(p.id)}
                  className={cn(
                    "h-9 rounded-full border px-3.5 text-sm font-medium transition-colors",
                    preset === p.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="run-from">{tr("ตั้งแต่")}</FieldLabel>
                <Input
                  id="run-from"
                  type="date"
                  className="h-10"
                  value={from}
                  onChange={(e) => {
                    setPreset("custom");
                    setFrom(e.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="run-to">{tr("ถึง")}</FieldLabel>
                <Input
                  id="run-to"
                  type="date"
                  className="h-10"
                  value={to}
                  onChange={(e) => {
                    setPreset("custom");
                    setTo(e.target.value);
                  }}
                />
              </Field>
              <Field className="col-span-2 sm:col-span-1">
                <FieldLabel htmlFor="run-title">{tr("ชื่องวด")}</FieldLabel>
                <Input id="run-title" className="h-10" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={valid ? payrollTitle(from, to, lang) : ""} />
              </Field>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{tr("พนักงานในงวดนี้")}</span>
              <span className="text-sm text-muted-foreground">
                {tr("เลือก")} <span className="num font-medium text-foreground">{picked.size}</span> {tr("คน")}
              </span>
            </div>
            {!valid ? (
              <p className="text-sm text-destructive">{tr("กรุณาเลือกช่วงวันที่ให้ถูกต้อง")}</p>
            ) : candidates.isPending ? (
              <Skeleton className="h-32" />
            ) : list.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{tr("ไม่มีพนักงานที่ทำงานในช่วงนี้")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {list.map((c) => (
                  <li key={c.employeeId}>
                    <label className={cn("flex items-center gap-3 px-3 py-2.5", c.overlap ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40")}>
                      <Checkbox checked={picked.has(c.employeeId)} disabled={!!c.overlap} onCheckedChange={(v) => toggle(c.employeeId, v === true)} className="size-4.5" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {" "}
                          · {c.position ?? c.fullName}
                          {!c.isActive ? tr(" (ลาออกแล้ว)") : ""}
                        </span>
                        {c.overlap ? (
                          <span className="flex items-center gap-1 text-xs text-destructive">
                            <TriangleAlert className="size-3" /> {tr("มีสลิปใน “{0}” ที่ช่วงวันซ้อนกันแล้ว", c.overlap.title)}
                          </span>
                        ) : null}
                      </span>
                      <span className="num text-sm text-muted-foreground">{payRateText(c.payType, c.payRate)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {tr("ยกเลิก")}
          </Button>
          <Button size="lg" onClick={() => create.mutate()} disabled={create.isPending || !valid || picked.size === 0} data-shot="create-run-submit">
            {create.isPending ? <Spinner /> : null} {tr("สร้างและคำนวณสลิป")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
