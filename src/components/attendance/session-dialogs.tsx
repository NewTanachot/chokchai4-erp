"use client";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LEAVE_TYPE_LABELS, type AttendanceRecord, type LeaveRecord, type LeaveType } from "@shared/contract";
import { addDays, dateTimeMs, hhmmMinutes, isDateStr, isHhmm, toDateStr } from "@shared/dates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Active employees (the time-clock list); `fallback` keeps a record's employee who has since left selectable. */
function EmployeeSelect({ value, onChange, disabled, fallback }: { value: string; onChange: (id: string) => void; disabled?: boolean; fallback?: { id: string; name: string } }) {
  const q = useQuery({ queryKey: ["attendance", "board"], queryFn: () => api.attendance.board() });
  const rows = (q.data?.rows ?? []).map((r) => ({ id: r.employeeId, label: `${r.name} (${r.fullName})` }));
  if (fallback && !rows.some((r) => r.id === fallback.id)) rows.push({ id: fallback.id, label: fallback.name });
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-10 w-full" aria-label={tr("พนักงาน")}>
        <SelectValue placeholder={tr("เลือกพนักงาน")} />
      </SelectTrigger>
      <SelectContent>
        {rows.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface SessionTarget {
  /** Existing session to edit, or null for a new one. */
  record: AttendanceRecord | null;
  employeeId?: string;
  date?: string;
}

/** Add a forgotten session or correct one (clock-out earlier than clock-in = the next day). */
export function SessionDialog({ target, onOpenChange }: { target: SessionTarget | null; onOpenChange: (o: boolean) => void }) {
  const r = target?.record ?? null;
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(toDateStr(Date.now()));
  const [timeIn, setTimeIn] = useState("08:00");
  const [timeOut, setTimeOut] = useState("17:00");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setEmployeeId(r?.employeeId ?? target.employeeId ?? "");
    setDate(r?.workDate ?? target.date ?? toDateStr(Date.now()));
    setTimeIn(r ? hhmm(r.clockIn) : "08:00");
    setTimeOut(r?.clockOut ? hhmm(r.clockOut) : "17:00");
    setOpen(!!r && r.clockOut === null);
    setNote(r?.note ?? "");
    setError(null);
  }, [target, r]);

  const save = useApiMutation(
    () => {
      const clockIn = dateTimeMs(date, timeIn);
      const outDate = hhmmMinutes(timeOut) <= hhmmMinutes(timeIn) ? addDays(date, 1) : date;
      const clockOut = open ? null : dateTimeMs(outDate, timeOut);
      const input = { employeeId, clockIn, clockOut, note };
      return r ? api.attendance.update({ ...input, id: r.id }) : api.attendance.create(input);
    },
    { successMessage: r ? tr("แก้ไขเวลาทำงานแล้ว") : tr("บันทึกเวลาทำงานแล้ว"), toastError: false, onSuccess: () => onOpenChange(false), onError: (e) => setError(e.message) },
  );
  const remove = useApiMutation(() => api.attendance.remove(r!.id), { successMessage: tr("ลบเวลาทำงานแล้ว"), onSuccess: () => onOpenChange(false) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) return setError(tr("กรุณาเลือกพนักงาน"));
    if (!isDateStr(date) || !isHhmm(timeIn) || (!open && !isHhmm(timeOut))) return setError(tr("กรุณาใส่วันที่และเวลาให้ครบ"));
    save.mutate();
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-shot="session-dialog">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{r ? tr("แก้ไขเวลาทำงาน") : tr("เพิ่มเวลาทำงาน")}</DialogTitle>
            <DialogDescription>{r ? tr("ทุกการแก้ไขจะถูกบันทึกในประวัติว่าใครแก้") : tr("ใช้เมื่อพนักงานลืมลงเวลา")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>{tr("พนักงาน")}</FieldLabel>
            <EmployeeSelect value={employeeId} onChange={setEmployeeId} disabled={!!target?.employeeId && !r} fallback={r ? { id: r.employeeId, name: r.employeeName } : undefined} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel htmlFor="sd-date">{tr("วันที่")}</FieldLabel>
              <Input id="sd-date" type="date" className="h-10" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="sd-in">{tr("เวลาเข้า")}</FieldLabel>
              <Input id="sd-in" type="time" className="h-10" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="sd-out">{tr("เวลาออก")}</FieldLabel>
              <Input id="sd-out" type="time" className="h-10" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} disabled={open} />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={open} onCheckedChange={(v) => setOpen(v === true)} /> {tr("ยังไม่ได้ลงเวลาออก (ยังทำงานอยู่)")}
          </label>
          <Field>
            <FieldLabel htmlFor="sd-note">{tr("หมายเหตุ")}</FieldLabel>
            <Input id="sd-note" className="h-10" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("เช่น ลืมลงเวลา, ออกไปส่งรถลูกค้า")} />
            <FieldDescription className="text-xs">{tr("เวลาออกน้อยกว่าเวลาเข้า = ออกงานวันถัดไป")}</FieldDescription>
          </Field>
          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="items-center">
            {r ? (
              <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
                <Trash2 /> {tr("ลบ")}
              </Button>
            ) : null}
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

export interface LeaveTarget {
  leave: LeaveRecord | null;
  employeeId?: string;
  date?: string;
}

const LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABELS) as LeaveType[];

/** Record / change / remove a leave day. */
export function LeaveDialog({ target, onOpenChange }: { target: LeaveTarget | null; onOpenChange: (o: boolean) => void }) {
  const l = target?.leave ?? null;
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(toDateStr(Date.now()));
  const [type, setType] = useState<LeaveType>("sick");
  const [halfDay, setHalfDay] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    setEmployeeId(l?.employeeId ?? target.employeeId ?? "");
    setDate(l?.date ?? target.date ?? toDateStr(Date.now()));
    setType(l?.type ?? "sick");
    setHalfDay(l?.halfDay ?? false);
    setNote(l?.note ?? "");
    setError(null);
  }, [target, l]);

  const save = useApiMutation(() => api.attendance.saveLeave({ id: l?.id, employeeId, date, type, halfDay, note }), {
    successMessage: tr("บันทึกวันลาแล้ว"),
    toastError: false,
    onSuccess: () => onOpenChange(false),
    onError: (e) => setError(e.message),
  });
  const remove = useApiMutation(() => api.attendance.removeLeave(l!.id), { successMessage: tr("ลบวันลาแล้ว"), onSuccess: () => onOpenChange(false) });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-shot="leave-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!employeeId) return setError(tr("กรุณาเลือกพนักงาน"));
            save.mutate();
          }}
          noValidate
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{l ? tr("แก้ไขวันลา") : tr("บันทึกวันลา")}</DialogTitle>
            <DialogDescription>{tr("ลาป่วย ลากิจ และลาพักร้อนได้รับค่าจ้าง · ลาไม่รับค่าจ้างจะถูกหักในสลิปพนักงานรายเดือน")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>{tr("พนักงาน")}</FieldLabel>
            <EmployeeSelect value={employeeId} onChange={setEmployeeId} disabled={!!target?.employeeId && !l} fallback={l ? { id: l.employeeId, name: l.employeeName } : undefined} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lv-date">{tr("วันที่ลา")}</FieldLabel>
            <Input id="lv-date" type="date" className="h-10" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={tr("ประเภทการลา")}>
            {LEAVE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/40",
                  type === t && "border-primary/50 bg-primary/[0.04] font-medium ring-1 ring-primary/30 dark:bg-primary/[0.08]",
                )}
              >
                {LEAVE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
            <Switch checked={halfDay} onCheckedChange={setHalfDay} />
            <span className="text-sm">{tr("ลาครึ่งวัน")}</span>
          </label>
          <Field>
            <FieldLabel htmlFor="lv-note">{tr("หมายเหตุ")}</FieldLabel>
            <Input id="lv-note" className="h-10" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="items-center">
            {l ? (
              <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
                <Trash2 /> {tr("ลบวันลา")}
              </Button>
            ) : null}
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
