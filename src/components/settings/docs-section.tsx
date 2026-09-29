"use client";
import { Hash } from "lucide-react";
import type { AppSettings } from "@shared/contract";
import { useNextDocNo } from "@/components/transactions/hooks";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { FormField, SectionCard, SwitchRow } from "./section-card";
import { useSectionForm, type FieldErrors } from "./use-section-form";

type Docs = AppSettings["docs"];

const PREFIX_RE = /^[A-Za-z0-9-]+$/;

function prefixError(p: string): string | undefined {
  if (!p.trim()) return tr("กรุณากรอกคำนำหน้า");
  if (p.length > 10) return tr("ยาวได้ไม่เกิน 10 ตัวอักษร");
  if (!PREFIX_RE.test(p)) return tr("ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และขีด (-)");
  return undefined;
}

function validate(v: Docs): FieldErrors<Docs> {
  return { salePrefix: prefixError(v.salePrefix), purchasePrefix: prefixError(v.purchasePrefix) };
}

/** Period part of a document number, e.g. "6909" (BE 2569, September). */
export function docPeriod(useBuddhistYear: boolean, now = new Date()): { yy: string; mm: string } {
  const year = now.getFullYear() + (useBuddhistYear ? 543 : 0);
  return { yy: String(year % 100).padStart(2, "0"), mm: String(now.getMonth() + 1).padStart(2, "0") };
}

function seqFrom(docNo: string | null, expectedHead: string): string | null {
  if (!docNo) return null;
  const m = /^(.*)-(\d+)$/.exec(docNo);
  return m && m[1] === expectedHead ? m[2] : null;
}

export function DocsSection({ saved }: { saved: Docs }) {
  const f = useSectionForm("docs", saved, { validate, successMessage: tr("บันทึกรูปแบบเลขที่เอกสารแล้ว") });
  const v = f.value;
  const { yy, mm } = docPeriod(v.useBuddhistYear);
  // Next numbers for a bill dated now (same month as the yy/mm shown above); null while loading.
  const saleNext = useNextDocNo("sale", null, { staleTime: 10_000 }) ?? null;
  const purchaseNext = useNextDocNo("purchase", null, { staleTime: 10_000 }) ?? null;

  const prefixInput = (field: "salePrefix" | "purchasePrefix") => ({
    id: `docs-${field}`,
    value: v[field],
    className: "h-9 w-40 font-medium uppercase tracking-wide",
    maxLength: 10,
    autoComplete: "off",
    spellCheck: false,
    "aria-invalid": f.errorOf(field) ? true : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => f.set(field, e.target.value.toUpperCase().replace(/\s/g, "")),
  });

  return (
    <SectionCard icon={Hash} title={tr("เลขที่เอกสาร")} description={tr("รูปแบบเลขที่บิลขายและบิลซื้อที่ระบบออกให้อัตโนมัติ")} form={f} shot="docs">
      <div className="space-y-6">
        <div className="grid gap-x-4 gap-y-5 @xl/settings:grid-cols-2">
          <FormField label={tr("คำนำหน้าบิลขาย")} htmlFor="docs-salePrefix" error={f.errorOf("salePrefix")} hint={tr("ค่าเริ่มต้น S (Sale)")}>
            <Input {...prefixInput("salePrefix")} />
          </FormField>
          <FormField label={tr("คำนำหน้าบิลซื้อ")} htmlFor="docs-purchasePrefix" error={f.errorOf("purchasePrefix")} hint={tr("ค่าเริ่มต้น P (Purchase)")}>
            <Input {...prefixInput("purchasePrefix")} />
          </FormField>
        </div>

        <SwitchRow
          title={tr("ใช้ปี พ.ศ. ในเลขที่เอกสาร")}
          description={tr("เปิด: ใช้ 2 หลักท้ายของปี พ.ศ. ({0}) · ปิด: ใช้ปี ค.ศ. ({1})", String((new Date().getFullYear() + 543) % 100).padStart(2, "0"), String(new Date().getFullYear() % 100).padStart(2, "0"))}
          checked={v.useBuddhistYear}
          onCheckedChange={(on) => f.set("useBuddhistYear", on)}
        />

        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="text-sm font-medium">{tr("ตัวอย่างเลขที่เอกสารถัดไป")}</div>
          <div className="mt-3 grid gap-4 @xl/settings:grid-cols-2">
            <DocNoExample
              label={tr("บิลขาย")}
              prefix={v.salePrefix}
              yy={yy}
              mm={mm}
              seq={seqFrom(saleNext, `${v.salePrefix}${yy}${mm}`)}
              invalid={!!prefixError(v.salePrefix)}
            />
            <DocNoExample
              label={tr("บิลซื้อ")}
              prefix={v.purchasePrefix}
              yy={yy}
              mm={mm}
              seq={seqFrom(purchaseNext, `${v.purchasePrefix}${yy}${mm}`)}
              invalid={!!prefixError(v.purchasePrefix)}
            />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {tr("เลขลำดับเริ่มนับ 0001 ใหม่ทุกเดือน · การเปลี่ยนรูปแบบมีผลกับบิลใหม่เท่านั้น บิลเก่ายังใช้เลขเดิม")}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

function DocNoExample({
  label,
  prefix,
  yy,
  mm,
  seq,
  invalid,
}: {
  label: string;
  prefix: string;
  yy: string;
  mm: string;
  seq: string | null;
  invalid: boolean;
}) {
  const parts: { text: string; label: string; bar: string; error?: boolean }[] = [
    { text: prefix || "?", label: tr("คำนำหน้า"), bar: "border-primary/70", error: invalid },
    { text: yy, label: tr("ปี"), bar: "border-chart-2/80" },
    { text: mm, label: tr("เดือน"), bar: "border-chart-4/80" },
    { text: `-${seq ?? "0001"}`, label: tr("ลำดับ"), bar: "border-chart-5/80" },
  ];
  const full = parts.map((p) => p.text).join("");
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      {/* The number reads as one word; coloured underlines show which part is which. */}
      <div className="mt-1 font-mono text-[1.75rem] leading-tight font-semibold tracking-wide break-all" data-shot={`docno-${label}`} aria-label={full}>
        {parts.map((p) => (
          <span key={p.label} className={cn("border-b-[3px] pb-0.5", p.bar, p.error && "text-destructive")} aria-hidden>
            {p.text}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-hidden>
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className={cn("h-[3px] w-3 rounded-full border-b-[3px]", p.bar)} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
