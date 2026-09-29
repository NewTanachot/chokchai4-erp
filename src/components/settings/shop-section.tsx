"use client";
import { ImageOff, ImagePlus, Sparkles, Store, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AppSettings } from "@shared/contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { dataUrlBytes, formatBytes, loadDefaultLogo, processLogo } from "./logo-image";
import { FormField, SectionCard } from "./section-card";
import { useSectionForm, type FieldErrors } from "./use-section-form";

type Shop = AppSettings["shop"];

function validate(v: Shop): FieldErrors<Shop> {
  const e: FieldErrors<Shop> = {};
  if (!v.name.trim()) e.name = tr("กรุณากรอกชื่อร้าน");
  else if (v.name.length > 200) e.name = tr("ชื่อร้านยาวเกินไป");
  const taxDigits = v.taxId.replace(/\D/g, "");
  if (v.taxId.trim() && taxDigits.length !== 13) e.taxId = tr("เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก");
  if (v.address.length > 1000) e.address = tr("ที่อยู่ยาวเกินไป");
  if (v.receiptFooter.length > 1000) e.receiptFooter = tr("ข้อความยาวเกินไป");
  return e;
}

export function ShopSection({ saved }: { saved: Shop }) {
  const f = useSectionForm("shop", saved, { validate, successMessage: tr("บันทึกข้อมูลร้านแล้ว") });
  const v = f.value;
  const text = (field: keyof Shop) => ({
    id: `shop-${field}`,
    value: v[field],
    "aria-invalid": f.errorOf(field) ? true : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => f.set(field, e.target.value),
  });

  return (
    <SectionCard
      icon={Store}
      title={tr("ข้อมูลร้าน")}
      description={tr("แสดงบนหัวใบเสร็จ ใบแจ้งหนี้ และเอกสารที่พิมพ์ออกจากโปรแกรม")}
      form={f}
      shot="shop"
    >
      <div className="grid gap-x-4 gap-y-5 @xl/settings:grid-cols-2">
        <FormField label={tr("ชื่อร้าน")} htmlFor="shop-name" required error={f.errorOf("name")}>
          <Input {...text("name")} className="h-9" autoFocus maxLength={200} placeholder={tr("เช่น โชคชัย 4 ยางยนต์")} />
        </FormField>
        <FormField label={tr("สาขา")} htmlFor="shop-branch" hint={tr("เว้นว่างได้ถ้ามีร้านเดียว")}>
          <Input {...text("branch")} className="h-9" maxLength={200} placeholder={tr("เช่น สำนักงานใหญ่")} />
        </FormField>
        <FormField label={tr("ที่อยู่")} htmlFor="shop-address" className="@xl/settings:col-span-2" error={f.errorOf("address")}>
          <Textarea {...text("address")} rows={3} className="min-h-20 resize-none" maxLength={1000} placeholder={tr("บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์")} />
        </FormField>
        <FormField label={tr("เบอร์โทร")} htmlFor="shop-phone">
          <Input {...text("phone")} className="h-9" inputMode="tel" maxLength={100} placeholder={tr("เช่น 081-234-5678")} />
        </FormField>
        <FormField label="LINE" htmlFor="shop-lineId" hint={tr("LINE ID หรือ LINE Official Account")}>
          <Input {...text("lineId")} className="h-9" maxLength={100} placeholder={tr("เช่น @chokchai4")} />
        </FormField>
        <FormField
          label={tr("เลขประจำตัวผู้เสียภาษี")}
          htmlFor="shop-taxId"
          hint={tr("13 หลัก — ใส่เมื่อต้องการให้แสดงบนใบเสร็จ / ใบกำกับภาษี")}
          error={f.errorOf("taxId")}
        >
          <Input {...text("taxId")} className="num h-9" inputMode="numeric" maxLength={50} placeholder="0-0000-00000-00-0" />
        </FormField>
        <div className="hidden @xl/settings:block" />
        <FormField
          label={tr("ข้อความท้ายใบเสร็จ")}
          htmlFor="shop-receiptFooter"
          className="@xl/settings:col-span-2"
          hint={tr("เช่น คำขอบคุณ เงื่อนไขการรับประกัน หรือเลขบัญชีสำหรับโอนเงิน")}
          error={f.errorOf("receiptFooter")}
        >
          <Textarea {...text("receiptFooter")} rows={2} className="min-h-16 resize-none" maxLength={1000} />
        </FormField>
      </div>

      <Separator className="my-6" />

      <div className="grid gap-6 @2xl/settings:grid-cols-[minmax(0,1fr)_17rem]">
        <LogoPicker value={v.logoDataUrl} onChange={(url) => f.set("logoDataUrl", url)} />
        <ReceiptPreview shop={v} />
      </div>
    </SectionCard>
  );
}

function LogoPicker({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"file" | "default" | null>(null);

  const run = async (kind: "file" | "default", job: () => Promise<string>) => {
    setBusy(kind);
    try {
      onChange(await job());
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-w-0">
      <div className="text-sm font-medium">{tr("โลโก้บนใบเสร็จ")}</div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {tr("รูป PNG หรือ JPG — ระบบย่อขนาดให้อัตโนมัติ (ไม่เกิน 400 พิกเซล) รูปพื้นหลังโปร่งใสหรือพื้นขาวจะพิมพ์ออกมาสวยที่สุด")}
      </p>
      <div className="mt-4 flex flex-wrap items-start gap-4">
        <div
          className={cn(
            "flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/40",
            !value && "border-dashed",
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={tr("โลโก้ร้าน")} className="size-full object-contain p-2" data-shot="logo-preview" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <ImageOff className="size-6" />
              <span className="text-xs">{tr("ยังไม่มีโลโก้")}</span>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void run("file", () => processLogo(file));
            }}
          />
          <Button type="button" variant="outline" size="lg" onClick={() => input.current?.click()} disabled={!!busy}>
            {busy === "file" ? <Spinner /> : <ImagePlus />} {tr("อัปโหลดรูปโลโก้…")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => void run("default", loadDefaultLogo)}
            disabled={!!busy}
            data-shot="logo-default"
          >
            {busy === "default" ? <Spinner /> : <Sparkles />} {tr("ใช้โลโก้ของร้าน (ค่าเริ่มต้น)")}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="lg" className="text-destructive hover:text-destructive" onClick={() => onChange("")} disabled={!!busy}>
              <Trash2 /> {tr("ลบโลโก้")}
            </Button>
          ) : null}
          {value ? <span className="num text-xs text-muted-foreground">{tr("ขนาดไฟล์ {0}", formatBytes(dataUrlBytes(value)))}</span> : null}
        </div>
      </div>
    </div>
  );
}

/** Rough look of the receipt header so staff can see what their changes do. */
function ReceiptPreview({ shop }: { shop: Shop }) {
  const lines = [
    shop.branch || null,
    shop.address || null,
    [shop.phone ? tr("โทร {0}", shop.phone) : null, shop.lineId ? `LINE ${shop.lineId}` : null].filter(Boolean).join("  ·  ") || null,
    shop.taxId ? tr("เลขประจำตัวผู้เสียภาษี {0}", shop.taxId) : null,
  ].filter(Boolean) as string[];
  return (
    <div className="min-w-0">
      <div className="mb-2 text-sm font-medium">{tr("ตัวอย่างบนใบเสร็จ")}</div>
      <div className="rounded-xl bg-muted/60 p-4 dark:bg-muted/40">
      <div className="relative mx-auto w-full max-w-[15rem] rounded-sm bg-card px-4 pt-4 pb-5 text-center text-[11px] leading-snug shadow-md ring-1 ring-foreground/5">
        {shop.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shop.logoDataUrl} alt="" className="mx-auto mb-2 size-14 object-contain" />
        ) : null}
        <div className="text-[13px] font-semibold break-words">{shop.name || tr("ชื่อร้าน")}</div>
        {lines.map((l, i) => (
          <div key={i} className="mt-0.5 break-words whitespace-pre-line text-muted-foreground">
            {l}
          </div>
        ))}
        <div className="my-2.5 border-t border-dashed" />
        <div className="font-medium">{tr("ใบเสร็จรับเงิน")}</div>
        <div className="mt-2 space-y-1 text-left">
          <div className="flex justify-between gap-2">
            <span className="truncate">{tr("ยาง 205/55R16 × 4")}</span>
            <span className="num">14,600.00</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="truncate">{tr("ถ่วงล้อ × 4")}</span>
            <span className="num">400.00</span>
          </div>
          <div className="flex justify-between gap-2 border-t border-dashed pt-1 font-semibold">
            <span>{tr("รวมทั้งสิ้น")}</span>
            <span className="num">15,000.00</span>
          </div>
        </div>
        {shop.receiptFooter ? (
          <>
            <div className="my-2.5 border-t border-dashed" />
            <div className="break-words whitespace-pre-line text-muted-foreground">{shop.receiptFooter}</div>
          </>
        ) : null}
      </div>
      </div>
    </div>
  );
}
