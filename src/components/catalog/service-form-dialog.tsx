"use client";
import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { z } from "zod";
import type { ServiceItem } from "@shared/contract";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { translatedResolver } from "@/lib/form-resolver";

export const SERVICE_UNIT_SUGGESTIONS = [tr("ครั้ง"), tr("คัน"), tr("ล้อ"), tr("เส้น"), tr("จุด"), tr("ต้น"), tr("ชุด"), tr("ชั่วโมง"), tr("งาน")];

const formSchema = z.object({
  name: z.string().trim().min(1, tr("กรุณากรอกชื่อบริการ")).max(200, tr("ชื่อบริการยาวเกินไป")),
  code: z.string().trim().max(100, tr("ยาวเกินไป")),
  unit: z.string().trim().min(1, tr("กรุณาระบุหน่วย")).max(30, tr("หน่วยยาวเกินไป")),
  defaultPrice: z.number().int().min(0, tr("ราคาต้องไม่ติดลบ")),
  isActive: z.boolean(),
  note: z.string().max(2000, tr("ยาวเกินไป")),
});
type FormValues = z.input<typeof formSchema>;

const toForm = (s: ServiceItem | null | undefined): FormValues => ({
  name: s?.name ?? "",
  code: s?.code ?? "",
  unit: s?.unit ?? tr("ครั้ง"),
  defaultPrice: s?.defaultPrice ?? 0,
  isActive: s?.isActive ?? true,
  note: s?.note ?? "",
});

/** Create / edit a service item (บริการ). Pass `service` to edit. */
export function ServiceFormDialog({
  open,
  onOpenChange,
  service,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service?: ServiceItem | null;
  onSaved?: (s: ServiceItem) => void;
}) {
  const isEdit = !!service;
  const nameRef = useRef<HTMLInputElement | null>(null);
  const { register, control, handleSubmit, reset, setError, formState } = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: translatedResolver(zodResolver(formSchema)),
    defaultValues: toForm(service),
  });
  const errors = formState.errors;

  useEffect(() => {
    if (open) reset(toForm(service));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, service?.id]);

  const save = useApiMutation(
    (v: z.output<typeof formSchema>) => (isEdit ? api.serviceItems.update({ ...v, id: service!.id }) : api.serviceItems.create(v)),
    {
      successMessage: (s) => (isEdit ? tr("บันทึก “{0}” แล้ว", s.name) : tr("เพิ่มบริการ “{0}” แล้ว", s.name)),
      toastError: false,
      onSuccess: (s) => {
        onSaved?.(s);
        onOpenChange(false);
      },
      onError: (e) => {
        const field = e instanceof ApiClientError ? (e.details as { field?: string } | undefined)?.field : undefined;
        if (field === "code") setError("code", { message: e.message }, { shouldFocus: true });
        else setError("root", { message: errorMessage(e) });
      },
    },
  );

  const nameReg = register("name");

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">{isEdit ? tr("แก้ไขบริการ") : tr("เพิ่มบริการ")}</DialogTitle>
          <DialogDescription>{tr("ราคาตั้งต้นจะถูกใส่ให้อัตโนมัติตอนออกบิล และแก้ไขได้ทุกครั้ง")}</DialogDescription>
        </DialogHeader>

        <form
          id="service-form"
          className="-mx-4 grid gap-4 overflow-y-auto px-4 pb-1 sm:grid-cols-2"
          noValidate
          onSubmit={handleSubmit((v) => save.mutate(v))}
        >
          <Field className="sm:col-span-2" data-invalid={!!errors.name}>
            <FieldLabel htmlFor="s-name">
              {tr("ชื่อบริการ")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              id="s-name"
              className="h-9"
              placeholder={tr("เช่น ถ่วงล้อ, ตั้งศูนย์ล้อ")}
              autoComplete="off"
              aria-invalid={!!errors.name}
              {...nameReg}
              ref={(el) => {
                nameReg.ref(el);
                nameRef.current = el;
              }}
            />
            <FieldError errors={[errors.name]} />
          </Field>

          <Field data-invalid={!!errors.defaultPrice}>
            <FieldLabel htmlFor="s-price">{tr("ราคาตั้งต้น")}</FieldLabel>
            <Controller
              control={control}
              name="defaultPrice"
              render={({ field }) => <MoneyInput id="s-price" className="h-9" value={field.value} onChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} />}
            />
            <FieldDescription className="text-xs">{tr("ใส่ 0 ได้ ถ้าราคาไม่แน่นอน (ค่อยใส่ตอนออกบิล)")}</FieldDescription>
            <FieldError errors={[errors.defaultPrice]} />
          </Field>

          <Field data-invalid={!!errors.unit}>
            <FieldLabel htmlFor="s-unit">
              {tr("หน่วย")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Controller
              control={control}
              name="unit"
              render={({ field }) => (
                <InputGroup className="h-9">
                  <InputGroupInput id="s-unit" autoComplete="off" aria-invalid={!!errors.unit} value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} />
                  <InputGroupAddon align="inline-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <InputGroupButton size="icon-xs" aria-label={tr("เลือกหน่วย")}>
                          <ChevronDown />
                        </InputGroupButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-32">
                        {SERVICE_UNIT_SUGGESTIONS.map((u) => (
                          <DropdownMenuItem key={u} onSelect={() => field.onChange(u)}>
                            {u}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </InputGroupAddon>
                </InputGroup>
              )}
            />
            <FieldError errors={[errors.unit]} />
          </Field>

          <Field data-invalid={!!errors.code}>
            <FieldLabel htmlFor="s-code">{tr("รหัสบริการ")}</FieldLabel>
            <Input id="s-code" className="h-9" placeholder={tr("ไม่บังคับ")} autoComplete="off" aria-invalid={!!errors.code} {...register("code")} />
            <FieldError errors={[errors.code]} />
          </Field>

          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <label
                htmlFor="s-active"
                className="flex cursor-pointer items-start gap-3 self-end rounded-lg border p-3 transition-colors hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 dark:has-data-checked:bg-primary/10"
              >
                <Switch id="s-active" checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{tr("เปิดใช้งาน")}</span>
                  <span className="text-xs text-muted-foreground">{tr("ปิดเพื่อซ่อนจากหน้าขาย")}</span>
                </span>
              </label>
            )}
          />

          <Field className="sm:col-span-2" data-invalid={!!errors.note}>
            <FieldLabel htmlFor="s-note">{tr("หมายเหตุ")}</FieldLabel>
            <Textarea id="s-note" rows={2} className="min-h-14" placeholder={tr("เช่น ราคานี้สำหรับรถเก๋ง รถกระบะบวกเพิ่ม")} {...register("note")} />
            <FieldError errors={[errors.note]} />
          </Field>

          {errors.root ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2">
              {errors.root.message}
            </div>
          ) : null}
        </form>

        <DialogFooter className="items-center">
          <span className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            {tr("กด")} <Kbd>Enter</Kbd> {tr("เพื่อบันทึก")}
          </span>
          <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tr("ยกเลิก")}
          </Button>
          <Button type="submit" form="service-form" size="lg" className="min-w-24" disabled={save.isPending} data-shot="service-save">
            {save.isPending ? <Spinner /> : null}
            {isEdit ? tr("บันทึก") : tr("เพิ่มบริการ")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
