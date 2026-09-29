"use client";
import { ArrowRight, Boxes } from "lucide-react";
import Link from "next/link";
import type { AppSettings } from "@shared/contract";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { SectionCard, SwitchRow } from "./section-card";
import { useSectionForm } from "./use-section-form";

type Inventory = AppSettings["inventory"];

function Example({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export function InventorySection({ saved }: { saved: Inventory }) {
  const f = useSectionForm("inventory", saved, { successMessage: tr("บันทึกการตั้งค่าสต็อกแล้ว") });
  const v = f.value;
  return (
    <SectionCard
      icon={Boxes}
      title={tr("สต็อกสินค้า")}
      description={tr("กำหนดวิธีตัดสต็อกและคิดราคาทุนเมื่อขายและซื้อสินค้า")}
      form={f}
      shot="stock"
      action={
        <Button asChild variant="ghost" size="sm" className="text-primary">
          <Link href="/products/">
            {tr("สินค้า & สต็อก")} <ArrowRight />
          </Link>
        </Button>
      }
    >
      <div className="space-y-3">
        <SwitchRow
          title={tr("อนุญาตให้ขายเกินสต็อก")}
          description={tr("ขายได้แม้จำนวนในสต็อกไม่พอ (สต็อกจะติดลบและมีคำเตือน) เหมาะกับร้านที่รับของเข้าแล้วยังไม่ได้บันทึกการซื้อ")}
          checked={v.allowNegativeStock}
          onCheckedChange={(on) => f.set("allowNegativeStock", on)}
        >
          <Example>
            {v.allowNegativeStock
              ? tr("ตอนนี้: มียาง 2 เส้น ขาย 4 เส้นได้ → สต็อกเหลือ −2 และระบบแจ้งเตือน")
              : tr("ตอนนี้: มียาง 2 เส้น ขาย 4 เส้นไม่ได้ → ต้องบันทึกการซื้อ/ปรับสต็อกก่อน")}
          </Example>
        </SwitchRow>
        <SwitchRow
          title={tr("อัปเดตราคาทุนตามราคาซื้อล่าสุด")}
          description={tr("เมื่อบันทึกการซื้อ ราคาทุนของสินค้าจะเปลี่ยนเป็นราคาที่ซื้อครั้งล่าสุดโดยอัตโนมัติ ใช้คำนวณกำไรในรายงาน")}
          checked={v.updateCostOnPurchase}
          onCheckedChange={(on) => f.set("updateCostOnPurchase", on)}
        >
          <Example>
            {v.updateCostOnPurchase
              ? tr("ตอนนี้: ทุนเดิม ฿2,900 ซื้อเข้าใหม่ ฿3,000 → ราคาทุนเปลี่ยนเป็น ฿3,000")
              : tr("ตอนนี้: ราคาทุนไม่เปลี่ยนตามการซื้อ — แก้ไขราคาทุนเองได้ที่หน้าสินค้า")}
          </Example>
        </SwitchRow>
      </div>
    </SectionCard>
  );
}
