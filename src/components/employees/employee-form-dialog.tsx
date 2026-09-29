"use client";
import { useEffect, useRef, useState } from "react";
import { employeeInputSchema, PAY_TYPE_LABELS, type Employee, type EmployeeInput, type PayType } from "@shared/contract";
import { toDateStr } from "@shared/dates";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";

type Form = {
  code: string;
  firstName: string;
  lastName: string;
  nickname: string;
  position: string;
  phone: string;
  lineId: string;
  nationalId: string;
  birthDate: string;
  address: string;
  emergencyName: string;
  emergencyPhone: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  payType: PayType;
  payRate: number;
  socialSecurity: boolean;
  bankName: string;
  bankAccount: string;
  note: string;
};

const toForm = (e: Employee | null | undefined): Form => ({
  code: e?.code ?? "",
  firstName: e?.firstName ?? "",
  lastName: e?.lastName ?? "",
  nickname: e?.nickname ?? "",
  position: e?.position ?? "",
  phone: e?.phone ?? "",
  lineId: e?.lineId ?? "",
  nationalId: e?.nationalId ?? "",
  birthDate: e?.birthDate ?? "",
  address: e?.address ?? "",
  emergencyName: e?.emergencyName ?? "",
  emergencyPhone: e?.emergencyPhone ?? "",
  startDate: e?.startDate ?? (e ? "" : toDateStr(Date.now())),
  endDate: e?.endDate ?? "",
  isActive: e?.isActive ?? true,
  payType: e?.payType ?? "monthly",
  payRate: e?.payRate ?? 0,
  socialSecurity: e?.socialSecurity ?? false,
  bankName: e?.bankName ?? "",
  bankAccount: e?.bankAccount ?? "",
  note: e?.note ?? "",
});

export const POSITION_SUGGESTIONS = [tr("ช่างยาง"), tr("ช่างช่วงล่าง"), tr("ช่างแบตเตอรี่"), tr("ผู้ช่วยช่าง"), tr("แคชเชียร์"), tr("พนักงานขาย"), tr("ผู้จัดการร้าน")];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="col-span-full mt-1 border-b pb-1.5 text-sm font-semibold text-muted-foreground">{children}</h3>;
}

/** Add / edit an employee (personal data, pay rate, bank account). */
export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee?: Employee | null;
  onSaved?: (e: Employee) => void;
}) {
  const isEdit = !!employee;
  const [f, setF] = useState<Form>(() => toForm(employee));
  const [errors, setErrors] = useState<Partial<Record<keyof Form | "root", string>>>({});
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setF(toForm(employee));
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined, root: undefined }));
  };

  const save = useApiMutation((input: EmployeeInput) => (isEdit ? api.employees.update({ ...input, id: employee!.id }) : api.employees.create(input)), {
    successMessage: (e) => (isEdit ? tr("บันทึกข้อมูล “{0}” แล้ว", e.displayName) : tr("เพิ่มพนักงาน “{0}” แล้ว", e.displayName)),
    toastError: false,
    onSuccess: (e) => {
      onSaved?.(e);
      onOpenChange(false);
    },
    onError: (e) => {
      const field = e instanceof ApiClientError ? (e.details as { field?: string } | undefined)?.field : undefined;
      if (field) setErrors({ [field]: e.message });
      else setErrors({ root: errorMessage(e) });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // The last working day only applies once they have left; it defaults to today.
    const input: EmployeeInput = { ...f, endDate: f.isActive ? null : f.endDate || toDateStr(Date.now()) };
    const parsed = employeeInputSchema.safeParse(input);
    if (!parsed.success) {
      const next: Partial<Record<keyof Form, string>> = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof Form] ??= issue.message;
      setErrors(next);
      return;
    }
    save.mutate(input);
  };

  const text = (k: keyof Form, label: string, opts: { placeholder?: string; required?: boolean; className?: string; inputMode?: "tel" | "numeric"; list?: string } = {}) => (
    <Field className={opts.className} data-invalid={!!errors[k] || undefined}>
      <FieldLabel htmlFor={`emp-${k}`}>
        {label}
        {opts.required ? <span className="text-destructive"> *</span> : null}
      </FieldLabel>
      <Input
        id={`emp-${k}`}
        ref={k === "firstName" ? firstRef : undefined}
        className="h-9"
        value={f[k] as string}
        onChange={(e) => set(k, e.target.value as never)}
        placeholder={opts.placeholder}
        inputMode={opts.inputMode}
        list={opts.list}
        autoComplete="off"
        aria-invalid={!!errors[k] || undefined}
      />
      {errors[k] ? <FieldError>{errors[k]}</FieldError> : null}
    </Field>
  );

  const dateField = (k: "birthDate" | "startDate" | "endDate", label: string) => (
    <Field data-invalid={!!errors[k] || undefined}>
      <FieldLabel htmlFor={`emp-${k}`}>{label}</FieldLabel>
      <Input id={`emp-${k}`} type="date" className="h-9" value={f[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k] || undefined} />
      {errors[k] ? <FieldError>{errors[k]}</FieldError> : null}
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstRef.current?.focus();
        }}
        data-shot="employee-form"
      >
        <DialogHeader>
          <DialogTitle className="text-lg">{isEdit ? tr("แก้ไขข้อมูลพนักงาน — {0}", employee!.displayName) : tr("เพิ่มพนักงาน")}</DialogTitle>
          <DialogDescription>{tr("ข้อมูลส่วนตัวและเงินเดือนดูได้เฉพาะผู้ที่มีสิทธิ์ “ข้อมูลพนักงานและเงินเดือน”")}</DialogDescription>
        </DialogHeader>
        <form id="employee-form" onSubmit={submit} noValidate className="-mx-4 grid gap-x-4 gap-y-3.5 overflow-y-auto px-4 pb-1 sm:grid-cols-3">
          <SectionTitle>{tr("ข้อมูลส่วนตัว")}</SectionTitle>
          {text("firstName", tr("ชื่อ"), { required: true })}
          {text("lastName", tr("นามสกุล"))}
          {text("nickname", tr("ชื่อเล่น"), { placeholder: tr("ใช้แสดงที่หน้าลงเวลา") })}
          {text("position", tr("ตำแหน่ง"), { placeholder: tr("เช่น ช่างยาง"), list: "emp-positions" })}
          <datalist id="emp-positions">
            {POSITION_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {text("code", tr("รหัสพนักงาน"), { placeholder: tr("ไม่บังคับ") })}
          {text("phone", tr("เบอร์โทร"), { inputMode: "tel" })}
          {text("nationalId", tr("เลขบัตรประชาชน"), { placeholder: tr("13 หลัก"), inputMode: "numeric" })}
          {dateField("birthDate", tr("วันเกิด"))}
          {text("lineId", "LINE ID")}
          <Field className="sm:col-span-3">
            <FieldLabel htmlFor="emp-address">{tr("ที่อยู่")}</FieldLabel>
            <Textarea id="emp-address" rows={2} className="min-h-14" value={f.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          {text("emergencyName", tr("ผู้ติดต่อกรณีฉุกเฉิน"), { placeholder: tr("ชื่อ / ความสัมพันธ์"), className: "sm:col-span-2" })}
          {text("emergencyPhone", tr("เบอร์ผู้ติดต่อฉุกเฉิน"), { inputMode: "tel" })}

          <SectionTitle>{tr("การทำงานและค่าจ้าง")}</SectionTitle>
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-sm font-medium">{tr("ประเภทค่าจ้าง")}</div>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={tr("ประเภทค่าจ้าง")}>
              {(["monthly", "daily"] as PayType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={f.payType === t}
                  onClick={() => set("payType", t)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40",
                    f.payType === t && "border-primary/50 bg-primary/[0.04] font-medium ring-1 ring-primary/30 dark:bg-primary/[0.08]",
                  )}
                >
                  {PAY_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <Field data-invalid={!!errors.payRate || undefined}>
            <FieldLabel htmlFor="emp-rate">{f.payType === "monthly" ? tr("เงินเดือน (บาท/เดือน)") : tr("ค่าแรง (บาท/วัน)")}</FieldLabel>
            <MoneyInput id="emp-rate" className="h-9" value={f.payRate} onChange={(v) => set("payRate", v ?? 0)} />
            {errors.payRate ? <FieldError>{errors.payRate}</FieldError> : null}
          </Field>
          {dateField("startDate", tr("วันเริ่มงาน"))}
          {text("bankName", tr("ธนาคาร"), { placeholder: tr("เช่น กสิกรไทย") })}
          {text("bankAccount", tr("เลขบัญชี"), { inputMode: "numeric" })}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 sm:col-span-2 dark:has-data-checked:bg-primary/10">
            <Switch checked={f.socialSecurity} onCheckedChange={(v) => set("socialSecurity", v)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">{tr("หักประกันสังคม")}</span>
              <span className="block text-xs text-muted-foreground">{tr("หักตามอัตราที่ตั้งไว้ในตั้งค่า → เวลางาน & เงินเดือน")}</span>
            </span>
          </label>
          <div className="sm:col-span-1" />
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 sm:col-span-2">
            <Switch checked={f.isActive} onCheckedChange={(v) => set("isActive", v)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">{tr("ยังทำงานอยู่")}</span>
              <span className="block text-xs text-muted-foreground">{tr("ปิดเมื่อลาออก — จะไม่แสดงที่หน้าลงเวลาและไม่ถูกใส่ในงวดเงินเดือนใหม่")}</span>
            </span>
          </label>
          {!f.isActive ? dateField("endDate", tr("วันทำงานวันสุดท้าย")) : <div />}

          <Field className="sm:col-span-3">
            <FieldLabel htmlFor="emp-note">{tr("หมายเหตุ")}</FieldLabel>
            <Textarea id="emp-note" rows={2} className="min-h-14" value={f.note} onChange={(e) => set("note", e.target.value)} />
            <FieldDescription className="text-xs">{tr("เช่น ทักษะ ใบขับขี่ ขนาดเสื้อยูนิฟอร์ม")}</FieldDescription>
          </Field>
          {errors.root ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-3">
              {errors.root}
            </p>
          ) : null}
        </form>
        <DialogFooter className="items-center">
          <span className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            {tr("กด")} <Kbd>Enter</Kbd> {tr("เพื่อบันทึก")}
          </span>
          <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tr("ยกเลิก")}
          </Button>
          <Button type="submit" form="employee-form" size="lg" className="min-w-24" disabled={save.isPending} data-shot="employee-save">
            {save.isPending ? <Spinner /> : null}
            {isEdit ? tr("บันทึก") : tr("เพิ่มพนักงาน")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
