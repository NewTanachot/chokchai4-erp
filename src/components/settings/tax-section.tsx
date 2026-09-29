"use client";
import { Percent } from "lucide-react";
import { computeTotals, type VatMode } from "@shared/calc";
import type { AppSettings } from "@shared/contract";
import { QtyInput } from "@/components/qty-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatBaht } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { FormField, SectionCard, SwitchRow } from "./section-card";
import { useSectionForm, type FieldErrors } from "./use-section-form";

type Tax = AppSettings["tax"];

const MODES: { value: VatMode; title: string; description: string }[] = [
  { value: "none", title: tr("ไม่มี VAT"), description: tr("ราคาขายไม่คิดภาษีมูลค่าเพิ่ม") },
  { value: "inclusive", title: tr("ราคารวม VAT แล้ว"), description: tr("ราคาที่ตั้งไว้รวมภาษีแล้ว ลูกค้าจ่ายเท่าราคาป้าย") },
  { value: "exclusive", title: tr("ราคายังไม่รวม VAT"), description: tr("บวกภาษีเพิ่มจากราคาที่ตั้งไว้ตอนคิดเงิน") },
];

function validate(v: Tax): FieldErrors<Tax> {
  if (!Number.isFinite(v.vatRate) || v.vatRate < 0 || v.vatRate > 100) return { vatRate: tr("อัตราภาษีต้องอยู่ระหว่าง 0–100%") };
  if (v.vatRegistered && v.vatRate === 0) return { vatRate: tr("กรุณาระบุอัตราภาษี (ปกติ 7%)") };
  return {};
}

export function TaxSection({ saved }: { saved: Tax }) {
  const f = useSectionForm("tax", saved, { validate, successMessage: tr("บันทึกการตั้งค่าภาษีแล้ว") });
  const v = f.value;
  const off = !v.vatRegistered;
  const example = (mode: VatMode) => computeTotals({ lines: [{ qty: 1, unitPrice: 100_000 }], vatMode: mode, vatRate: v.vatRate || 0 });

  return (
    <SectionCard icon={Percent} title={tr("ภาษีมูลค่าเพิ่ม (VAT)")} description={tr("ใช้คำนวณภาษีในบิลขายและบิลซื้อ และแสดงในใบเสร็จ / ใบกำกับภาษี")} form={f} shot="tax">
      <div className="space-y-6">
        <SwitchRow
          title={tr("ร้านจดทะเบียนภาษีมูลค่าเพิ่ม (VAT)")}
          description={tr("เปิดเมื่อร้านจด VAT แล้วเท่านั้น ถ้ายังไม่ได้จด บิลขายทั้งหมดจะไม่มี VAT")}
          checked={v.vatRegistered}
          onCheckedChange={(on) => f.patch(on ? { vatRegistered: true } : { vatRegistered: false, defaultVatMode: "none", defaultPurchaseVatMode: "none" })}
          shot="vat-registered"
        />

        <fieldset disabled={off} className={cn("space-y-6", off && "opacity-60")}>
          <FormField label={tr("อัตราภาษี")} htmlFor="tax-rate" error={f.errorOf("vatRate")} hint={tr("อัตราปกติในประเทศไทยคือ 7%")}>
            <div className="flex items-center gap-2">
              <QtyInput
                id="tax-rate"
                className="h-9 w-24 text-base"
                value={v.vatRate}
                onChange={(n) => f.set("vatRate", n)}
                aria-invalid={f.errorOf("vatRate") ? true : undefined}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </FormField>

          <div>
            <div className="text-sm font-medium">{tr("ค่าเริ่มต้นของบิลขายใหม่")}</div>
            <p className="mt-0.5 text-sm text-muted-foreground">{tr("เลือกแบบที่ใช้บ่อยที่สุด — ตอนขายยังเปลี่ยนได้ทุกบิล")}</p>
            <RadioGroup
              value={off ? "none" : v.defaultVatMode}
              onValueChange={(m) => f.set("defaultVatMode", m as VatMode)}
              className="mt-3 grid gap-3 @2xl/settings:grid-cols-3"
            >
              {MODES.map((m) => {
                const t = example(m.value);
                const active = (off ? "none" : v.defaultVatMode) === m.value;
                return (
                  <label
                    key={m.value}
                    htmlFor={`vat-${m.value}`}
                    className={cn(
                      "flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors hover:bg-muted/40",
                      active && "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/30 dark:bg-primary/[0.08]",
                      off && "cursor-not-allowed",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <RadioGroupItem id={`vat-${m.value}`} value={m.value} />
                      <span className="font-medium">{m.title}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{m.description}</p>
                    <dl className="num mt-auto space-y-0.5 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{tr("ราคาสินค้า")}</dt>
                        <dd>{formatBaht(100_000)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">VAT</dt>
                        <dd>{formatBaht(t.vatAmount)}</dd>
                      </div>
                      <div className="flex justify-between gap-2 font-medium">
                        <dt>{tr("ลูกค้าจ่าย")}</dt>
                        <dd>{formatBaht(t.total)}</dd>
                      </div>
                    </dl>
                  </label>
                );
              })}
            </RadioGroup>
          </div>

          <div>
            <div className="text-sm font-medium">{tr("ค่าเริ่มต้นของบิลซื้อใหม่")}</div>
            <p className="mt-0.5 text-sm text-muted-foreground">{tr("ตั้งตามใบกำกับภาษีที่ผู้ขายส่วนใหญ่ออกให้ — ตอนบันทึกซื้อยังเปลี่ยนได้ทุกบิล")}</p>
            <RadioGroup
              value={off ? "none" : v.defaultPurchaseVatMode}
              onValueChange={(m) => f.set("defaultPurchaseVatMode", m as VatMode)}
              className="mt-3 grid gap-2 @2xl/settings:grid-cols-3"
              aria-label={tr("ค่าเริ่มต้นของบิลซื้อใหม่")}
            >
              {MODES.map((m) => {
                const active = (off ? "none" : v.defaultPurchaseVatMode) === m.value;
                return (
                  <label
                    key={m.value}
                    htmlFor={`purchase-vat-${m.value}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/40",
                      active && "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/30 dark:bg-primary/[0.08]",
                      off && "cursor-not-allowed",
                    )}
                  >
                    <RadioGroupItem id={`purchase-vat-${m.value}`} value={m.value} />
                    <span className="font-medium">{m.title}</span>
                  </label>
                );
              })}
            </RadioGroup>
          </div>
        </fieldset>
      </div>
    </SectionCard>
  );
}
