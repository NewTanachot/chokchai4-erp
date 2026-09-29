"use client";
import { Printer, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PAPER_LABELS, type AppSettings, type PaperSize } from "@shared/contract";
import { LANGUAGES } from "@shared/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/api";
import { tr, trc } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { FormField, SectionCard, StepperInput, SwitchRow } from "./section-card";
import { useSectionForm, type FieldErrors } from "./use-section-form";

type Print = AppSettings["print"];

const PAPERS: { value: PaperSize; hint: string; w: number; h: number }[] = [
  { value: "80mm", hint: tr("เครื่องพิมพ์ใบเสร็จทั่วไป"), w: 14, h: 40 },
  { value: "58mm", hint: tr("เครื่องพิมพ์ใบเสร็จขนาดเล็ก"), w: 10, h: 40 },
  { value: "a4", hint: tr("เครื่องพิมพ์สำนักงาน"), w: 29, h: 40 },
  { value: "a5", hint: tr("ครึ่ง A4"), w: 21, h: 29 },
];

/** Radix Select cannot use "" as an item value. */
const SYSTEM_DEFAULT = "__system_default__";

function validate(v: Print): FieldErrors<Print> {
  if (!Number.isInteger(v.copies) || v.copies < 1 || v.copies > 10) return { copies: tr("จำนวนสำเนา 1–10 ชุด") };
  return {};
}

export function PrintSection({ saved }: { saved: Print }) {
  const f = useSectionForm("print", saved, { validate, successMessage: tr("บันทึกการตั้งค่าการพิมพ์แล้ว") });
  const v = f.value;

  return (
    <SectionCard icon={Printer} title={tr("การพิมพ์")} description={tr("ค่าเริ่มต้นเวลาพิมพ์ใบเสร็จ ใบแจ้งหนี้ และใบบันทึกการซื้อ")} form={f} shot="print">
      <div className="space-y-7">
        <div>
          <div className="text-sm font-medium">{tr("ขนาดกระดาษเริ่มต้น")}</div>
          <RadioGroup
            value={v.defaultPaper}
            onValueChange={(p) => f.set("defaultPaper", p as PaperSize)}
            className="mt-3 grid grid-cols-2 gap-3 @2xl/settings:grid-cols-4"
          >
            {PAPERS.map((p) => {
              const active = v.defaultPaper === p.value;
              return (
                <label
                  key={p.value}
                  htmlFor={`paper-${p.value}`}
                  className={cn(
                    "relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border px-3 pt-4 pb-3 text-center transition-colors hover:bg-muted/40",
                    active && "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/30 dark:bg-primary/[0.08]",
                  )}
                >
                  <RadioGroupItem id={`paper-${p.value}`} value={p.value} className="absolute top-2.5 left-2.5" />
                  <div className="flex h-11 items-end">
                    <div
                      className={cn("rounded-[3px] border-2 bg-background", active ? "border-primary" : "border-muted-foreground/40")}
                      style={{ width: p.w, height: p.h }}
                    >
                      <div className={cn("mx-auto mt-1.5 h-0.5 w-3/5 rounded", active ? "bg-primary/60" : "bg-muted-foreground/30")} />
                      <div className={cn("mx-auto mt-1 h-0.5 w-2/5 rounded", active ? "bg-primary/40" : "bg-muted-foreground/20")} />
                    </div>
                  </div>
                  <div className="text-sm leading-snug font-medium">{PAPER_LABELS[p.value]}</div>
                  <div className="text-xs text-muted-foreground">{p.hint}</div>
                </label>
              );
            })}
          </RadioGroup>
        </div>

        <div className="grid gap-x-6 gap-y-5 @2xl/settings:grid-cols-[minmax(0,1fr)_auto]">
          <PrinterPicker value={v.printerName} onChange={(name) => f.set("printerName", name)} />
          <FormField label={tr("จำนวนสำเนา")} htmlFor="print-copies" error={f.errorOf("copies")} hint={tr("พิมพ์ครั้งละกี่ใบ")}>
            <StepperInput id="print-copies" value={v.copies} min={1} max={10} suffix={trc("copies", "ชุด")} onChange={(n) => f.set("copies", n)} invalid={!!f.errorOf("copies")} />
          </FormField>
          <FormField
            label={tr("ภาษาในเอกสาร")}
            htmlFor="print-language"
            hint={tr("ภาษาของใบเสร็จ ใบแจ้งหนี้ ใบบันทึกการซื้อ และสลิปเงินเดือน (แยกจากภาษาของโปรแกรม)")}
          >
            <Select value={v.documentLanguage} onValueChange={(x) => f.set("documentLanguage", x === "en" ? "en" : "th")}>
              <SelectTrigger id="print-language" className="h-9 w-full max-w-xs" data-shot="print-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <div className="space-y-3">
          <SwitchRow
            title={tr("พิมพ์ทันทีโดยไม่ถาม")}
            description={tr("ส่งไปที่เครื่องพิมพ์ที่เลือกไว้ได้เลย โดยไม่เปิดหน้าต่างเลือกเครื่องพิมพ์ของระบบ")}
            checked={v.silent}
            onCheckedChange={(on) => f.set("silent", on)}
          />
          <SwitchRow
            title={tr("แสดงโลโก้บนใบเสร็จ")}
            description={tr("พิมพ์โลโก้ร้าน (ตั้งค่าได้ที่ ข้อมูลร้าน) ไว้ที่หัวเอกสาร")}
            checked={v.showLogo}
            onCheckedChange={(on) => f.set("showLogo", on)}
          />
          <SwitchRow
            title={tr("เปิดหน้าพิมพ์อัตโนมัติหลังบันทึกการขาย")}
            description={tr("บันทึกบิลขายเสร็จแล้วแสดงหน้าตัวอย่างก่อนพิมพ์ทันที ไม่ต้องกดปุ่มพิมพ์เอง")}
            checked={v.autoPrintAfterSale}
            onCheckedChange={(on) => f.set("autoPrintAfterSale", on)}
          />
          <SwitchRow
            title={tr("พิมพ์ชื่อผู้ออกบิลบนใบเสร็จ")}
            description={tr("แสดง “ผู้ออกบิล: ชื่อผู้ใช้” ที่บันทึกบิลนั้น บนใบเสร็จ ใบแจ้งหนี้ และใบบันทึกการซื้อ")}
            checked={v.showStaffName}
            onCheckedChange={(on) => f.set("showStaffName", on)}
          />
        </div>
      </div>
    </SectionCard>
  );
}

function PrinterPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const q = useQuery({ queryKey: ["print", "printers"], queryFn: () => api.print.printers(), retry: false, staleTime: 60_000 });
  const label = tr("เครื่องพิมพ์");

  if (q.isPending) {
    return (
      <FormField label={label}>
        <Skeleton className="h-9 w-full max-w-md" />
      </FormField>
    );
  }

  if (q.isError) {
    const notReady = q.error instanceof ApiClientError && q.error.code === "NOT_IMPLEMENTED";
    return (
      <FormField
        label={label}
        htmlFor="print-printer"
        hint={
          notReady
            ? tr("ยังดึงรายชื่อเครื่องพิมพ์อัตโนมัติไม่ได้ — พิมพ์ชื่อเครื่องพิมพ์ให้ตรงกับในเครื่อง หรือเว้นว่างเพื่อใช้เครื่องพิมพ์หลัก")
            : tr("ดึงรายชื่อเครื่องพิมพ์ไม่สำเร็จ — พิมพ์ชื่อเครื่องพิมพ์เอง หรือเว้นว่างเพื่อใช้เครื่องพิมพ์หลักของเครื่อง")
        }
      >
        <Input
          id="print-printer"
          className="h-9 max-w-md"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={tr("เครื่องพิมพ์หลักของระบบ")}
          maxLength={300}
        />
      </FormField>
    );
  }

  const printers = q.data;
  const known = !value || printers.some((p) => p.name === value);
  return (
    <FormField
      label={label}
      htmlFor="print-printer"
      hint={printers.length ? tr("เลือก “เครื่องพิมพ์หลักของระบบ” ถ้าต้องการใช้เครื่องที่ตั้งเป็นค่าเริ่มต้นในเครื่องคอมพิวเตอร์") : tr("ไม่พบเครื่องพิมพ์ที่ติดตั้งในเครื่องนี้ — ติดตั้งไดรเวอร์เครื่องพิมพ์แล้วกดรีเฟรช")}
    >
      <div className="flex max-w-md items-center gap-2">
        <Select value={value || SYSTEM_DEFAULT} onValueChange={(v) => onChange(v === SYSTEM_DEFAULT ? "" : v)}>
          <SelectTrigger id="print-printer" className="h-9 min-w-0 flex-1 data-[size=default]:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={SYSTEM_DEFAULT}>{tr("เครื่องพิมพ์หลักของระบบ")}</SelectItem>
            {printers.length || !known ? <SelectSeparator /> : null}
            {printers.map((p) => (
              <SelectItem key={p.name} value={p.name}>
                {p.displayName || p.name}
                {p.isDefault ? <span className="text-muted-foreground"> {tr("(หลัก)")}</span> : null}
              </SelectItem>
            ))}
            {!known ? (
              <SelectItem value={value}>
                {value} <span className="text-muted-foreground">{tr("(ไม่พบในเครื่องนี้)")}</span>
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon-lg" onClick={() => void q.refetch()} disabled={q.isFetching} aria-label={tr("รีเฟรชรายชื่อเครื่องพิมพ์")}>
          <RefreshCw className={cn(q.isFetching && "animate-spin")} />
        </Button>
      </div>
    </FormField>
  );
}
