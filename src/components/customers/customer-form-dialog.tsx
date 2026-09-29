"use client";
/**
 * Create / edit a customer. Used by the customers screens and by the bill form ("ลูกค้าใหม่").
 * Create when `customer` is empty, edit otherwise. `defaultValues` pre-fills a new customer
 * (e.g. the name or phone the user already typed in a search box).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Save, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { customerInputSchema, type Customer, type CustomerInput } from "@shared/contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { customerViewHref, phoneDigits, samePhone } from "./customer-utils";
import { translatedResolver } from "@/lib/form-resolver";

type FormValues = CustomerInput;
type FormOutput = z.output<typeof customerInputSchema>;

const FIELDS = ["name", "phone", "lineId", "email", "shopName", "taxId", "address", "note"] as const;

function toFormValues(customer?: Customer | null, defaults?: Partial<CustomerInput>): FormValues {
  const out = {} as Record<(typeof FIELDS)[number], string>;
  for (const k of FIELDS) out[k] = (customer ? customer[k] : defaults?.[k]) ?? "";
  return out;
}

/** Debounced value (ms). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Other customers that already use this phone number (warning only - never blocks saving). */
function DuplicatePhoneWarning({ phone, selfId, onNavigate }: { phone: string; selfId?: string; onNavigate: () => void }) {
  const digits = useDebounced(phoneDigits(phone), 350);
  const enabled = digits.length >= 9;
  const { data } = useQuery({
    queryKey: ["customers", "list", { search: digits, limit: 5 }],
    queryFn: () => api.customers.list({ search: digits, limit: 5 }),
    enabled,
  });
  const matches = enabled ? (data?.items ?? []).filter((c) => c.id !== selfId && samePhone(c.phone, digits)) : [];
  if (matches.length === 0) return null;
  return (
    <div
      role="status"
      className="col-span-full flex items-start gap-2.5 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 leading-relaxed">
        <p className="font-medium">{tr("เบอร์นี้มีในระบบแล้ว")}</p>
        <p className="text-muted-foreground">
          {tr("เป็นเบอร์ของ ")}
          {matches.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? ", " : null}
              <Link
                href={customerViewHref(c.id)}
                onClick={onNavigate}
                className="font-medium text-primary underline underline-offset-3 hover:text-primary/80"
              >
                {c.name}
              </Link>
            </span>
          ))}{tr(" — ถ้าเป็นคนเดียวกันไม่ต้องเพิ่มใหม่ (ยังบันทึกต่อได้)")}
        </p>
      </div>
    </div>
  );
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
  defaultValues,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | null;
  defaultValues?: Partial<CustomerInput>;
  onSaved?: (c: Customer) => void;
}) {
  const isEdit = !!customer;
  const uid = useId();
  const fid = (k: string) => `${uid}-${k}`;

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: translatedResolver(zodResolver(customerInputSchema)),
    defaultValues: toFormValues(customer, defaultValues),
  });
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = form;

  // Fresh values every time the dialog opens (or switches to another customer).
  useEffect(() => {
    if (open) reset(toFormValues(customer, defaultValues));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id, customer?.updatedAt]);

  const phone = useWatch({ control, name: "phone" }) ?? "";

  const save = useApiMutation(
    (values: FormOutput) => (customer ? api.customers.update({ ...values, id: customer.id }) : api.customers.create(values)),
    {
      successMessage: (c) => (isEdit ? tr("บันทึกข้อมูลลูกค้าแล้ว") : tr("เพิ่มลูกค้า “{0}” แล้ว", c.name)),
      onSuccess: (c) => {
        onSaved?.(c);
        onOpenChange(false);
      },
    },
  );

  const submit = handleSubmit((values) => save.mutate(values));

  return (
    <Dialog open={open} onOpenChange={(v) => !save.isPending && onOpenChange(v)}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl" data-shot="customer-form">
        <form
          noValidate
          className="flex max-h-[calc(100dvh-2rem)] flex-col"
          onSubmit={(e) => {
            // The dialog may be rendered inside another form (e.g. the bill form): React events bubble
            // through portals, so keep this submit to ourselves.
            e.stopPropagation();
            void submit(e);
          }}
        >
          <DialogHeader className="border-b px-5 pt-5 pb-4">
            <DialogTitle className="text-lg">{isEdit ? tr("แก้ไขข้อมูลลูกค้า") : tr("เพิ่มลูกค้าใหม่")}</DialogTitle>
            <DialogDescription>
              {tr("ช่องที่มี")} <span className="text-destructive">*</span> {tr("ต้องกรอก ที่เหลือใส่เท่าที่ทราบ")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-x-4 gap-y-4 overflow-y-auto px-5 py-5 sm:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor={fid("name")}>
                <span>
                  {tr("ชื่อลูกค้า")} <span className="text-destructive">*</span>
                </span>
              </FieldLabel>
              <Input
                id={fid("name")}
                autoFocus
                autoComplete="off"
                placeholder={tr("เช่น สมชาย ใจดี")}
                className="h-9"
                aria-invalid={!!errors.name}
                {...register("name")}
              />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor={fid("shopName")}>{tr("ชื่อร้านค้า / บริษัท")}</FieldLabel>
              <Input id={fid("shopName")} autoComplete="off" placeholder={tr("ถ้าเป็นลูกค้าร้านค้าหรือบริษัท")} className="h-9" {...register("shopName")} />
            </Field>

            <Field>
              <FieldLabel htmlFor={fid("phone")}>{tr("เบอร์โทร")}</FieldLabel>
              <Input
                id={fid("phone")}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder={tr("เช่น 081-234-5678")}
                className="num h-9"
                {...register("phone")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={fid("lineId")}>LINE ID</FieldLabel>
              <Input id={fid("lineId")} autoComplete="off" placeholder={tr("เช่น somchai.j")} className="h-9" {...register("lineId")} />
            </Field>

            {open ? <DuplicatePhoneWarning phone={phone} selfId={customer?.id} onNavigate={() => onOpenChange(false)} /> : null}

            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor={fid("email")}>{tr("อีเมล")}</FieldLabel>
              <Input
                id={fid("email")}
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@example.com"
                className="h-9"
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field>
              <FieldLabel htmlFor={fid("taxId")}>{tr("เลขประจำตัวผู้เสียภาษี")}</FieldLabel>
              <Input
                id={fid("taxId")}
                inputMode="numeric"
                autoComplete="off"
                placeholder={tr("13 หลัก (สำหรับออกใบกำกับภาษี)")}
                className="num h-9"
                {...register("taxId")}
              />
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor={fid("address")}>{tr("ที่อยู่")}</FieldLabel>
              <Textarea id={fid("address")} rows={2} placeholder={tr("ที่อยู่สำหรับออกใบกำกับภาษี / ส่งของ")} className="min-h-16" {...register("address")} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor={fid("note")}>{tr("หมายเหตุ")}</FieldLabel>
              <Textarea id={fid("note")} rows={2} placeholder={tr("เช่น ลูกค้าประจำ ชอบยางยี่ห้อ Michelin")} className="min-h-16" {...register("note")} />
            </Field>
          </div>

          <DialogFooter className="m-0 rounded-b-xl px-5 py-4">
            <Button type="button" variant="outline" size="lg" className="min-w-24" disabled={save.isPending} onClick={() => onOpenChange(false)}>
              {tr("ยกเลิก")}
            </Button>
            <Button type="submit" size="lg" className="min-w-32" disabled={save.isPending} data-shot="customer-save">
              {save.isPending ? <Spinner /> : <Save />}
              {isEdit ? tr("บันทึกการแก้ไข") : tr("บันทึกลูกค้า")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
