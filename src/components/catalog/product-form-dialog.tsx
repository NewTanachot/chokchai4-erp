"use client";
import { useEffect, useRef } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { z } from "zod";
import type { Product, ProductCreate, ProductUpdate } from "@shared/contract";
import { MoneyInput } from "@/components/money-input";
import { QtyInput } from "@/components/qty-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError, errorMessage } from "@/lib/api";
import { formatBaht } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { formatPercent, marginOf } from "./shared";
import { translatedResolver } from "@/lib/form-resolver";

export const UNIT_SUGGESTIONS = [tr("เส้น"), tr("ลูก"), tr("ชิ้น"), tr("ตัว"), tr("ต้น"), tr("ชุด"), tr("คู่"), tr("ขวด"), tr("แกลลอน"), tr("ลิตร")];

const NONE = "__none__";

const formSchema = z.object({
  name: z.string().trim().min(1, tr("กรุณากรอกชื่อสินค้า")).max(200, tr("ชื่อสินค้ายาวเกินไป")),
  categoryId: z.string(),
  brand: z.string().trim().max(100, tr("ยาวเกินไป")),
  model: z.string().trim().max(100, tr("ยาวเกินไป")),
  spec: z.string().trim().max(200, tr("ยาวเกินไป")),
  sku: z.string().trim().max(100, tr("ยาวเกินไป")),
  barcode: z.string().trim().max(100, tr("ยาวเกินไป")),
  unit: z.string().trim().min(1, tr("กรุณาระบุหน่วย")).max(30, tr("หน่วยยาวเกินไป")),
  costPrice: z.number().int().min(0, tr("ราคาต้องไม่ติดลบ")),
  sellPrice: z.number().int().min(0, tr("ราคาต้องไม่ติดลบ")),
  initialStock: z.number().min(0, tr("จำนวนต้องไม่ติดลบ")),
  minStock: z.number().min(0, tr("จำนวนต้องไม่ติดลบ")),
  trackStock: z.boolean(),
  isActive: z.boolean(),
  note: z.string().max(2000, tr("ยาวเกินไป")),
});
type FormValues = z.input<typeof formSchema>;

function toForm(p: Product | null | undefined, defaultCategoryId?: string | null): FormValues {
  return {
    name: p?.name ?? "",
    categoryId: p ? (p.categoryId ?? NONE) : (defaultCategoryId ?? NONE),
    brand: p?.brand ?? "",
    model: p?.model ?? "",
    spec: p?.spec ?? "",
    sku: p?.sku ?? "",
    barcode: p?.barcode ?? "",
    unit: p?.unit ?? tr("ชิ้น"),
    costPrice: p?.costPrice ?? 0,
    sellPrice: p?.sellPrice ?? 0,
    initialStock: 0,
    minStock: p?.minStock ?? 0,
    trackStock: p?.trackStock ?? true,
    isActive: p?.isActive ?? true,
    note: p?.note ?? "",
  };
}

/** Unit that usually goes with a category (used only when creating and the unit was not touched). */
function unitForCategory(name: string | undefined): string | null {
  if (!name) return null;
  // Category names are data (Thai by default, maybe English).
  const n = name.toLowerCase();
  if (n.includes("ยาง") || /tyre|tire/.test(n)) return tr("เส้น");
  if (n.includes("แบต") || n.includes("batter")) return tr("ลูก");
  return null;
}

/**
 * Create / edit a product. Pass `product` to edit; omit (or null) to create.
 * `defaultCategoryId` pre-selects the category when creating.
 */
export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  defaultCategoryId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  defaultCategoryId?: string | null;
  onSaved?: (product: Product) => void;
}) {
  const isEdit = !!product;
  const nameRef = useRef<HTMLInputElement | null>(null);
  const addAnother = useRef(false);
  const categories = useQuery({ queryKey: ["categories", "list"], queryFn: () => api.categories.list(), enabled: open });

  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: translatedResolver(zodResolver(formSchema)),
    defaultValues: toForm(product, defaultCategoryId),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const { register, control, handleSubmit, reset, setError, setValue, getValues, formState } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (open) reset(toForm(product, defaultCategoryId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const [costPrice, sellPrice, trackStock, categoryId] = useWatch({ control, name: ["costPrice", "sellPrice", "trackStock", "categoryId"] });

  // Suggest the usual unit for the chosen category (create mode, unit untouched).
  useEffect(() => {
    if (isEdit || formState.dirtyFields.unit) return;
    const cat = categories.data?.find((c) => c.id === categoryId);
    const u = unitForCategory(cat?.name);
    if (u && getValues("unit") !== u) setValue("unit", u);
  }, [categoryId, categories.data, isEdit, formState.dirtyFields.unit, getValues, setValue]);

  const save = useApiMutation(
    (v: z.output<typeof formSchema>) => {
      const base = {
        name: v.name,
        categoryId: v.categoryId === NONE ? null : v.categoryId,
        brand: v.brand,
        model: v.model,
        spec: v.spec,
        sku: v.sku,
        barcode: v.barcode,
        unit: v.unit,
        costPrice: v.costPrice,
        sellPrice: v.sellPrice,
        minStock: v.minStock,
        trackStock: v.trackStock,
        isActive: v.isActive,
        note: v.note,
      };
      return isEdit
        ? api.products.update({ ...base, id: product!.id } satisfies ProductUpdate)
        : api.products.create({ ...base, initialStock: v.trackStock ? v.initialStock : 0 } satisfies ProductCreate);
    },
    {
      successMessage: (p) => (isEdit ? tr("บันทึก “{0}” แล้ว", p.name) : tr("เพิ่มสินค้า “{0}” แล้ว", p.name)),
      toastError: false,
      onSuccess: (p) => {
        onSaved?.(p);
        if (addAnother.current) {
          const keep = getValues();
          reset({ ...toForm(null), categoryId: keep.categoryId, brand: keep.brand, unit: keep.unit, trackStock: keep.trackStock });
          requestAnimationFrame(() => nameRef.current?.focus());
        } else {
          onOpenChange(false);
        }
      },
      onError: (e) => {
        const field = e instanceof ApiClientError ? (e.details as { field?: string } | undefined)?.field : undefined;
        if (field === "sku") setError("sku", { message: e.message }, { shouldFocus: true });
        else setError("root", { message: errorMessage(e) });
      },
    },
  );

  const submit = (another: boolean) => {
    addAnother.current = another;
    void handleSubmit((v) => save.mutate(v))();
  };

  const { profit, percent } = marginOf(costPrice ?? 0, sellPrice ?? 0);
  const nameReg = register("name");

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">{isEdit ? tr("แก้ไขสินค้า") : tr("เพิ่มสินค้า")}</DialogTitle>
          <DialogDescription>
            {isEdit ? tr("แก้ไขข้อมูลและราคา (จำนวนคงเหลือปรับได้ที่ปุ่ม “ปรับสต็อก”)") : tr("กรอกข้อมูลสินค้า ช่องที่มี * ต้องกรอก")}
          </DialogDescription>
        </DialogHeader>

        <form
          id="product-form"
          className="-mx-4 overflow-y-auto px-4 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
          noValidate
        >
          <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-12">
            <Field className="sm:col-span-8" data-invalid={!!errors.name}>
              <FieldLabel htmlFor="p-name">
                {tr("ชื่อสินค้า")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="p-name"
                className="h-9"
                placeholder={tr("เช่น Michelin Primacy 4")}
                aria-invalid={!!errors.name}
                autoComplete="off"
                {...nameReg}
                ref={(el) => {
                  nameReg.ref(el);
                  nameRef.current = el;
                }}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field className="sm:col-span-4">
              <FieldLabel htmlFor="p-category">{tr("หมวดหมู่")}</FieldLabel>
              <Controller
                control={control}
                name="categoryId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="p-category" className="h-9 w-full">
                      <SelectValue placeholder={tr("เลือกหมวดหมู่")} />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value={NONE}>
                        <span className="text-muted-foreground">{tr("ไม่ระบุหมวดหมู่")}</span>
                      </SelectItem>
                      {categories.data?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field className="sm:col-span-3" data-invalid={!!errors.brand}>
              <FieldLabel htmlFor="p-brand">{tr("ยี่ห้อ")}</FieldLabel>
              <Input id="p-brand" className="h-9" placeholder={tr("เช่น Michelin, GS")} autoComplete="off" {...register("brand")} />
              <FieldError errors={[errors.brand]} />
            </Field>

            <Field className="sm:col-span-4" data-invalid={!!errors.model}>
              <FieldLabel htmlFor="p-model">{tr("รุ่น")}</FieldLabel>
              <Input id="p-model" className="h-9" placeholder={tr("เช่น Primacy 4")} autoComplete="off" {...register("model")} />
              <FieldError errors={[errors.model]} />
            </Field>

            <Field className="sm:col-span-5" data-invalid={!!errors.spec}>
              <FieldLabel htmlFor="p-spec">{tr("สเปก / ขนาด")}</FieldLabel>
              <Input id="p-spec" className="h-9" placeholder={tr("เช่น 205/55R16 91V หรือ 12V 65Ah")} autoComplete="off" {...register("spec")} />
              <FieldError errors={[errors.spec]} />
            </Field>

            <Field className="sm:col-span-6" data-invalid={!!errors.sku}>
              <FieldLabel htmlFor="p-sku">{tr("รหัสสินค้า (SKU)")}</FieldLabel>
              <Input id="p-sku" className="h-9" placeholder={tr("ไม่บังคับ")} autoComplete="off" aria-invalid={!!errors.sku} {...register("sku")} />
              <FieldError errors={[errors.sku]} />
            </Field>

            <Field className="sm:col-span-6" data-invalid={!!errors.barcode}>
              <FieldLabel htmlFor="p-barcode">{tr("บาร์โค้ด")}</FieldLabel>
              <Input id="p-barcode" className="h-9" placeholder={tr("สแกนหรือพิมพ์ (ไม่บังคับ)")} autoComplete="off" {...register("barcode")} />
              <FieldError errors={[errors.barcode]} />
            </Field>
          </div>

          <SectionTitle>{tr("ราคา (ต่อหน่วย)")}</SectionTitle>
          <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-3">
            <Field data-invalid={!!errors.costPrice}>
              <FieldLabel htmlFor="p-cost">{tr("ราคาทุน")}</FieldLabel>
              <Controller
                control={control}
                name="costPrice"
                render={({ field }) => (
                  <MoneyInput id="p-cost" className="h-9" value={field.value} onChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} />
                )}
              />
              <FieldError errors={[errors.costPrice]} />
            </Field>
            <Field data-invalid={!!errors.sellPrice}>
              <FieldLabel htmlFor="p-sell">{tr("ราคาขาย")}</FieldLabel>
              <Controller
                control={control}
                name="sellPrice"
                render={({ field }) => (
                  <MoneyInput id="p-sell" className="h-9" value={field.value} onChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} />
                )}
              />
              <FieldError errors={[errors.sellPrice]} />
            </Field>
            <Field>
              <FieldLabel>{tr("กำไรต่อหน่วย")}</FieldLabel>
              <MarginBox cost={costPrice ?? 0} sell={sellPrice ?? 0} profit={profit} percent={percent} />
            </Field>
          </div>

          <SectionTitle>{tr("สต็อก")}</SectionTitle>
          <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-6">
            <Field className={isEdit ? "sm:col-span-3" : "sm:col-span-2"} data-invalid={!!errors.unit}>
              <FieldLabel htmlFor="p-unit">
                {tr("หน่วย")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Controller
                control={control}
                name="unit"
                render={({ field }) => (
                  <InputGroup className="h-9">
                    <InputGroupInput
                      id="p-unit"
                      autoComplete="off"
                      aria-invalid={!!errors.unit}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                    <InputGroupAddon align="inline-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <InputGroupButton size="icon-xs" aria-label={tr("เลือกหน่วย")}>
                            <ChevronDown />
                          </InputGroupButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-32">
                          {UNIT_SUGGESTIONS.map((u) => (
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

            {!isEdit ? (
              <Field className="sm:col-span-2" data-invalid={!!errors.initialStock} data-disabled={!trackStock}>
                <FieldLabel htmlFor="p-initial">{tr("จำนวนตั้งต้น (มีอยู่ตอนนี้)")}</FieldLabel>
                <Controller
                  control={control}
                  name="initialStock"
                  render={({ field }) => (
                    <QtyInput id="p-initial" className="h-9" disabled={!trackStock} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
                  )}
                />
                <FieldError errors={[errors.initialStock]} />
              </Field>
            ) : null}

            <Field className={isEdit ? "sm:col-span-3" : "sm:col-span-2"} data-invalid={!!errors.minStock} data-disabled={!trackStock}>
              <FieldLabel htmlFor="p-min">{tr("แจ้งเตือนเมื่อเหลือ")}</FieldLabel>
              <Controller
                control={control}
                name="minStock"
                render={({ field }) => (
                  <QtyInput id="p-min" className="h-9" disabled={!trackStock} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
                )}
              />
              <FieldError errors={[errors.minStock]} />
            </Field>

            <Controller
              control={control}
              name="trackStock"
              render={({ field }) => (
                <SwitchCard
                  id="p-track"
                  className="sm:col-span-3"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  title={tr("นับสต็อก")}
                  description={tr("ปิดถ้าเป็นของที่ไม่ต้องนับจำนวนคงเหลือ")}
                />
              )}
            />
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <SwitchCard
                  id="p-active"
                  className="sm:col-span-3"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  title={tr("เปิดขาย")}
                  description={tr("ปิดเพื่อซ่อนจากหน้าขาย (ประวัติยังอยู่ครบ)")}
                />
              )}
            />

            <Field className="sm:col-span-6" data-invalid={!!errors.note}>
              <FieldLabel htmlFor="p-note">{tr("หมายเหตุ")}</FieldLabel>
              <Textarea id="p-note" rows={2} className="min-h-14" placeholder={tr("เช่น ตำแหน่งที่เก็บ, เงื่อนไขรับประกัน")} {...register("note")} />
              <FieldError errors={[errors.note]} />
            </Field>
          </div>

          {errors.root ? (
            <div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
          {!isEdit ? (
            <Button type="button" variant="outline" size="lg" onClick={() => submit(true)} disabled={save.isPending}>
              {tr("บันทึกแล้วเพิ่มอีก")}
            </Button>
          ) : null}
          <Button type="submit" form="product-form" size="lg" className="min-w-24" disabled={save.isPending} data-shot="product-save">
            {save.isPending ? <Spinner /> : null}
            {isEdit ? tr("บันทึก") : tr("เพิ่มสินค้า")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 mb-2.5 flex items-center gap-3">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function MarginBox({ cost, sell, profit, percent }: { cost: number; sell: number; profit: number; percent: number | null }) {
  const empty = cost === 0 && sell === 0;
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex h-9 items-center justify-end gap-1.5 rounded-lg px-2.5 text-sm",
        empty ? "bg-muted/60 text-muted-foreground" : profit < 0 ? "bg-destructive/10 text-destructive" : "bg-income/10",
      )}
    >
      {empty ? (
        <span className="mr-auto text-xs">{tr("ใส่ราคาเพื่อดูกำไร")}</span>
      ) : profit < 0 ? (
        <>
          <span className="mr-auto text-xs">{tr("ขาดทุน")}</span>
          <span className="num font-semibold">{formatBaht(profit)}</span>
        </>
      ) : (
        <>
          {percent !== null ? <span className="num mr-auto text-xs text-muted-foreground">{tr("{0} ของราคาขาย", formatPercent(percent))}</span> : null}
          <span className="num font-semibold text-income">{formatBaht(profit)}</span>
        </>
      )}
    </div>
  );
}

function SwitchCard({
  id,
  checked,
  onCheckedChange,
  title,
  description,
  className,
}: {
  id: string;
  className?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 dark:has-data-checked:bg-primary/10",
        className,
      )}
    >
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
