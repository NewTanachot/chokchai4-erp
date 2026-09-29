"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ClipboardCheck, Minus, Plus } from "lucide-react";
import type { Product } from "@shared/contract";
import { roundQty } from "@shared/money";
import { QtyInput } from "@/components/qty-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { formatQty } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { SignedQty } from "./shared";

type Mode = "add" | "remove" | "set";

const MODES: { value: Mode; label: string; icon: typeof Plus; qtyLabel: string }[] = [
  { value: "add", label: tr("เพิ่ม"), icon: Plus, qtyLabel: tr("จำนวนที่เพิ่ม") },
  { value: "remove", label: tr("ลด"), icon: Minus, qtyLabel: tr("จำนวนที่ลด") },
  { value: "set", label: tr("ตั้งยอดใหม่ (นับจริง)"), icon: ClipboardCheck, qtyLabel: tr("จำนวนที่นับได้จริง") },
];

/** Shown in the page's language; the chosen one is saved as the movement note. */
export const ADJUST_REASONS = [tr("นับสต็อก"), tr("ของชำรุด/เสียหาย"), tr("ของแถม/ตัวอย่าง"), tr("อื่น ๆ")];
type Reason = string;
/** "Other": the details field becomes the note. */
const OTHER_REASON = ADJUST_REASONS[3];

/** Most likely reason per mode; used until the user picks a reason themselves. */
const DEFAULT_REASON: Record<Mode, Reason> = { add: tr("นับสต็อก"), remove: tr("ของชำรุด/เสียหาย"), set: tr("นับสต็อก") };

/** Manual stock correction: add / remove / set to a counted quantity, with a reason. */
export function StockAdjustDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null | undefined;
}) {
  const [mode, setMode] = useState<Mode>("add");
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState<Reason>(tr("นับสต็อก"));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonTouched = useRef(false);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode("add");
      setQty(0);
      setReason(tr("นับสต็อก"));
      setNote("");
      setError(null);
      reasonTouched.current = false;
    }
  }, [open, product?.id]);

  const current = product?.stockQty ?? 0;
  const delta = roundQty(mode === "add" ? qty : mode === "remove" ? -qty : qty - current);
  const result = roundQty(current + delta);
  const unit = product?.unit ?? "";

  const save = useApiMutation(
    () => {
      const detail = note.trim();
      const text = reason === OTHER_REASON ? detail : detail ? `${reason} — ${detail}` : reason;
      return api.products.adjustStock({ productId: product!.id, qty: delta, note: text });
    },
    {
      successMessage: (p) => tr("ปรับสต็อกแล้ว คงเหลือ {0} {1}", formatQty(p.stockQty), p.unit),
      onSuccess: () => onOpenChange(false),
    },
  );

  const submit = () => {
    if (!product) return;
    if (qty < 0) return setError(tr("จำนวนต้องไม่ติดลบ"));
    if (delta === 0) return setError(mode === "set" ? tr("จำนวนที่นับได้เท่ากับยอดคงเหลือเดิม ไม่ต้องปรับ") : tr("กรุณาใส่จำนวน"));
    if (reason === OTHER_REASON && !note.trim()) return setError(tr("กรุณาระบุเหตุผลในช่องรายละเอียด"));
    setError(null);
    save.mutate();
  };

  const modeInfo = MODES.find((m) => m.value === mode)!;
  const disabled = !product?.trackStock;

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          qtyRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">{tr("ปรับสต็อก")}</DialogTitle>
          <DialogDescription className="truncate">
            {product ? [product.name, product.spec].filter(Boolean).join(" · ") : ""}
          </DialogDescription>
        </DialogHeader>

        <form
          id="stock-adjust-form"
          className="-mx-4 grid gap-4 overflow-y-auto px-4 pb-1"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex items-center justify-between rounded-lg bg-muted/60 px-4 py-3">
            <span className="text-sm text-muted-foreground">{tr("คงเหลือตอนนี้")}</span>
            <span className="text-lg font-semibold">
              <span className={cn("num", current < 0 && "text-destructive")}>{formatQty(current)}</span>{" "}
              <span className="text-sm font-normal text-muted-foreground">{unit}</span>
            </span>
          </div>

          {disabled ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              {tr("สินค้านี้ตั้งค่า “ไม่นับสต็อก” จึงปรับยอดไม่ได้ — เปิด “นับสต็อก” ได้ที่หน้าแก้ไขสินค้า")}
            </p>
          ) : (
            <>
              <div role="radiogroup" aria-label={tr("วิธีปรับ")} className="grid grid-cols-[1fr_1fr_1.6fr] gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.value}
                    data-shot={`adjust-mode-${m.value}`}
                    onClick={() => {
                      setMode(m.value);
                      if (!reasonTouched.current) setReason(DEFAULT_REASON[m.value]);
                      setQty(m.value === "set" ? Math.max(0, current) : 0);
                      setError(null);
                      requestAnimationFrame(() => qtyRef.current?.focus());
                    }}
                    className={cn(
                      "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      mode === m.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-card hover:bg-muted dark:bg-input/30 dark:hover:bg-input/50",
                    )}
                  >
                    <m.icon className="size-4" />
                    {m.label}
                  </button>
                ))}
              </div>

              <Field data-invalid={!!error && qty <= 0}>
                <FieldLabel htmlFor="adj-qty">
                  {modeInfo.qtyLabel} ({unit})
                </FieldLabel>
                <QtyInput id="adj-qty" ref={qtyRef} className="h-11 text-lg" value={qty} onChange={setQty} />
              </Field>

              <Field>
                <FieldLabel>{tr("เหตุผล")}</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {ADJUST_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={reason === r}
                      onClick={() => {
                        reasonTouched.current = true;
                        setReason(r);
                      }}
                      className={cn(
                        "h-8 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        reason === r
                          ? "border-primary bg-primary/10 font-medium text-primary dark:bg-primary/20"
                          : "hover:bg-muted dark:bg-input/30 dark:hover:bg-input/50",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="adj-note">
                  {tr("รายละเอียด")}
                  {reason === OTHER_REASON ? "" : tr(" (ไม่บังคับ)")}
                </FieldLabel>
                <Input
                  id="adj-note"
                  className="h-9"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={reason === OTHER_REASON ? tr("ระบุเหตุผล") : tr("เช่น ยางบวม 1 เส้น, นับประจำเดือน")}
                  autoComplete="off"
                />
              </Field>

              <div
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-4 py-3",
                  delta !== 0 ? "border-primary/30 bg-primary/5 dark:bg-primary/10" : "border-dashed",
                )}
                aria-live="polite"
              >
                <span className="text-sm text-muted-foreground">{tr("หลังปรับ")}</span>
                <span className="flex items-center gap-2 text-base">
                  <span className="num text-muted-foreground">{formatQty(current)}</span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <span className={cn("num text-lg font-semibold", result < 0 && "text-destructive")}>{formatQty(result)}</span>
                  <span className="text-sm text-muted-foreground">{unit}</span>
                  {delta !== 0 ? (
                    <span className="ml-1 rounded-full bg-background px-2 py-0.5 text-sm ring-1 ring-border">
                      <SignedQty qty={delta} />
                    </span>
                  ) : null}
                </span>
              </div>
              {delta !== 0 && result < 0 ? <p className="-mt-2 text-sm text-destructive">{tr("ยอดหลังปรับจะติดลบ — ตรวจสอบจำนวนอีกครั้ง")}</p> : null}
              {error ? <FieldError>{error}</FieldError> : null}
            </>
          )}
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tr("ยกเลิก")}
          </Button>
          <Button type="submit" form="stock-adjust-form" size="lg" disabled={disabled || save.isPending} data-shot="adjust-save">
            {save.isPending ? <Spinner /> : null}
            {tr("บันทึกการปรับสต็อก")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
