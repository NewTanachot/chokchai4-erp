"use client";
/**
 * Editable line items of a bill. One DOM, two layouts (container queries):
 * - wide (>= 56rem): classic table row  ลำดับ | รายการ | จำนวน | หน่วย | ราคา/หน่วย | ส่วนลด | รวม | ลบ
 * - narrow: name on the first row, numbers on the second (fits next to the sticky summary panel).
 */
import { Minus, PackageOpen, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { lineTotal, purchaseUnitCost, type VatMode } from "@shared/calc";
import type { Product, ServiceItem, TransactionType } from "@shared/contract";
import { MoneyInput } from "@/components/money-input";
import { QtyInput } from "@/components/qty-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBaht, formatQty } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { catalogPrice, type DraftLine } from "./bill-draft";

/** Column sizes are fixed (no `auto`) so a single header row lines up with every line. */
const NARROW_COLS = "grid-cols-[28px_8rem_3.25rem_minmax(0,1fr)_minmax(0,0.85fr)_7rem_32px]";
const WIDE_COLS = "@4xl:grid-cols-[32px_minmax(0,1fr)_8rem_3.5rem_8rem_6.75rem_7rem_32px]";

const ROW_GRID = cn(
  "grid items-start gap-x-2 gap-y-1",
  NARROW_COLS,
  "[grid-template-areas:'idx_name_name_name_name_name_del'_'._qty_unit_price_disc_total_.']",
  WIDE_COLS,
  "@4xl:[grid-template-areas:'idx_name_qty_unit_price_disc_total_del'] @4xl:items-center",
);

const HEAD_CELLS = (
  <>
    <span className="text-center [grid-area:idx]">#</span>
    <span className="hidden [grid-area:name] @4xl:block">{tr("รายการ")}</span>
    <span className="text-center [grid-area:qty]">{tr("จำนวน")}</span>
    <span className="[grid-area:unit]">{tr("หน่วย")}</span>
    <span className="text-right [grid-area:price]">{tr("ราคา/หน่วย")}</span>
    <span className="text-right [grid-area:disc]">{tr("ส่วนลด")}</span>
    <span className="text-right [grid-area:total]">{tr("รวม")}</span>
  </>
);

export interface LineContext {
  products: Map<string, Product | null>;
  services: Map<string, ServiceItem | null>;
  /** Edit mode: qty per product already on the stored bill (it is given back before the check). */
  originalQty: Map<string, number>;
  /** The bill's VAT mode and rate (purchase lines show their net cost without VAT). */
  vat: { mode: VatMode; rate: number };
}

/** Stock the bill may use per product, and the qty this draft asks for. */
export function stockShortages(type: TransactionType, lines: DraftLine[], ctx: LineContext) {
  const out = new Map<string, { available: number; requested: number; unit: string }>();
  if (type !== "sale") return out;
  const want = new Map<string, number>();
  for (const l of lines) if (l.productId) want.set(l.productId, (want.get(l.productId) ?? 0) + (l.qty || 0));
  for (const [pid, requested] of want) {
    const p = ctx.products.get(pid);
    if (!p || !p.trackStock) continue;
    const available = Math.round((p.stockQty + (ctx.originalQty.get(pid) ?? 0)) * 100) / 100;
    if (requested > available + 1e-9) out.set(pid, { available, requested, unit: p.unit });
  }
  return out;
}

export function BillLines({
  type,
  lines,
  ctx,
  onChange,
  onRemove,
  highlightKey,
}: {
  type: TransactionType;
  lines: DraftLine[];
  ctx: LineContext;
  onChange: (key: string, patch: Partial<DraftLine>) => void;
  onRemove: (key: string) => void;
  highlightKey?: string | null;
}) {
  const shortages = stockShortages(type, lines, ctx);

  return (
    <div className="@container">
      <div
        className={cn(
          "grid gap-x-2 border-b px-3 pb-2 text-xs font-medium text-muted-foreground",
          NARROW_COLS,
          "[grid-template-areas:'idx_qty_unit_price_disc_total_del']",
          WIDE_COLS,
          "@4xl:[grid-template-areas:'idx_name_qty_unit_price_disc_total_del']",
        )}
        aria-hidden
      >
        {HEAD_CELLS}
      </div>
      <ol className="divide-y">
        {lines.map((line, i) => (
          <LineRow
            key={line.key}
            index={i}
            type={type}
            line={line}
            ctx={ctx}
            shortage={line.productId ? shortages.get(line.productId) : undefined}
            onChange={(patch) => onChange(line.key, patch)}
            onRemove={() => onRemove(line.key)}
            highlight={highlightKey === line.key}
          />
        ))}
      </ol>
    </div>
  );
}

function LineRow({
  index,
  type,
  line,
  ctx,
  shortage,
  onChange,
  onRemove,
  highlight,
}: {
  index: number;
  type: TransactionType;
  line: DraftLine;
  ctx: LineContext;
  shortage?: { available: number; requested: number; unit: string };
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  highlight: boolean;
}) {
  const product = line.productId ? ctx.products.get(line.productId) : undefined;
  const service = line.serviceItemId ? ctx.services.get(line.serviceItemId) : undefined;
  const normal = catalogPrice(type, line, product, service);
  const priceChanged = normal !== null && normal !== line.unitPrice;
  const total = lineTotal(line);
  const invalidQty = !(line.qty > 0);
  // Purchase: the product cost becomes the net cost per unit (after the line discount, without VAT), shown when it
  // differs from the typed price.
  const inclVat = ctx.vat.mode === "inclusive" && ctx.vat.rate > 0;
  const net = type === "purchase" && line.itemType === "product" && line.qty > 0 ? purchaseUnitCost(line, ctx.vat.mode, ctx.vat.rate) : null;
  const netCost = net !== null && net !== line.unitPrice ? net : null;
  const nameMissing = line.itemType === "custom" && !line.name.trim();

  let secondary: React.ReactNode = null;
  if (line.itemType === "product") {
    if (product === null) secondary = <span className="text-destructive">{tr("สินค้านี้ถูกลบจากระบบแล้ว")}</span>;
    else if (product) {
      const bits = [product.sku, product.trackStock ? tr("คงเหลือ {0} {1}", formatQty(product.stockQty), product.unit) : tr("ไม่นับสต็อก")].filter(Boolean);
      secondary = <span>{bits.join(" · ")}</span>;
    }
  } else if (line.itemType === "service") {
    secondary = <span>{tr("บริการ{0}", service === null ? tr(" (ถูกลบจากระบบแล้ว)") : "")}</span>;
  } else {
    secondary = <span>{tr("รายการอื่น ๆ (พิมพ์ชื่อเอง)")}</span>;
  }

  return (
    <li
      className={cn(
        ROW_GRID,
        "px-3 py-2.5 transition-colors duration-700",
        highlight && "bg-primary/6",
        shortage && "bg-warning/8",
      )}
      data-line={index + 1}
      data-line-key={line.key}
    >
      <span className="num flex h-9 items-center justify-center text-sm text-muted-foreground [grid-area:idx]">{index + 1}</span>

      <div className="min-w-0 [grid-area:name]">
        <Input
          value={line.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={line.itemType === "custom" ? tr("ชื่อรายการ เช่น ค่าแรง, ค่าขนส่ง") : tr("ชื่อรายการ")}
          aria-invalid={nameMissing || undefined}
          autoFocus={line.itemType === "custom" && !line.name}
          className="h-9 border-transparent bg-transparent px-2 text-[15px] font-medium shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
          aria-label={tr("ชื่อรายการที่ {0}", index + 1)}
        />
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 px-2 text-xs text-muted-foreground">
          {secondary}
          {netCost !== null ? (
            <span className="num" data-shot={`net-cost-${index + 1}`}>
              {tr("· ต้นทุนสุทธิ{0} {1}/{2}", inclVat ? tr(" (ไม่รวม VAT)") : "", formatBaht(netCost), line.unit || tr("หน่วย"))}
            </span>
          ) : null}
          {shortage ? (
            <span className="inline-flex items-center gap-1 font-medium text-warning-foreground dark:text-warning">
              <TriangleAlert className="size-3.5" />
              {tr("สต็อกไม่พอ (เหลือ {0})", formatQty(shortage.available))}
            </span>
          ) : null}
        </div>
      </div>

      <div className="[grid-area:qty]">
        <div className="flex items-center">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 rounded-r-none"
            onClick={() => onChange({ qty: Math.max(1, Math.round((line.qty - 1) * 100) / 100) })}
            disabled={line.qty <= 1}
            aria-label={tr("ลดจำนวน")}
            tabIndex={-1}
          >
            <Minus />
          </Button>
          <QtyInput
            value={line.qty}
            onChange={(qty) => onChange({ qty })}
            aria-invalid={invalidQty || undefined}
            className="h-9 w-14 rounded-none border-x-0 px-1 text-center text-[15px] font-medium"
            aria-label={tr("จำนวนรายการที่ {0}", index + 1)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 rounded-l-none"
            onClick={() => onChange({ qty: Math.round((line.qty + 1) * 100) / 100 })}
            aria-label={tr("เพิ่มจำนวน")}
            tabIndex={-1}
          >
            <Plus />
          </Button>
        </div>
      </div>

      <div className="min-w-0 [grid-area:unit]">
        {line.itemType === "custom" ? (
          <Input
            value={line.unit ?? ""}
            onChange={(e) => onChange({ unit: e.target.value })}
            placeholder={tr("หน่วย")}
            className="h-9 w-full px-2"
            aria-label={tr("หน่วย")}
          />
        ) : (
          <span className="flex h-9 items-center text-sm text-muted-foreground">{line.unit || "-"}</span>
        )}
      </div>

      <div className="min-w-0 [grid-area:price]">
        <MoneyInput
          value={line.unitPrice}
          onChange={(v) => onChange({ unitPrice: v ?? 0 })}
          className={cn("h-9 text-[15px]", priceChanged && "border-primary/50")}
          aria-label={tr("ราคาต่อหน่วยรายการที่ {0}", index + 1)}
        />
        {priceChanged ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onChange({ unitPrice: normal! })}
                className="mt-0.5 ml-auto flex items-center gap-1 text-[11px] leading-4 text-muted-foreground hover:text-primary"
              >
                <RotateCcw className="size-3" />
                <span className="num">{tr("ราคาปกติ {0}", formatBaht(normal!))}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{tr("ใช้ราคาปกติ")}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="min-w-0 [grid-area:disc]">
        <MoneyInput
          value={line.discount}
          onChange={(v) => onChange({ discount: v ?? 0 })}
          className={cn("h-9", line.discount === 0 && "text-muted-foreground")}
          aria-label={tr("ส่วนลดรายการที่ {0}", index + 1)}
        />
      </div>

      <div className="min-w-0 text-right [grid-area:total]">
        <span className="num flex h-9 items-center justify-end text-[15px] font-semibold">{formatBaht(total)}</span>
      </div>

      <div className="flex h-9 items-center justify-center [grid-area:del]">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={onRemove}
              aria-label={tr("ลบรายการที่ {0}", index + 1)}
              data-shot={`remove-line-${index + 1}`}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tr("ลบรายการ")}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}

export function LinesEmpty({ type }: { type: TransactionType }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <PackageOpen className="size-6" />
      </span>
      <p className="font-medium">{tr("ยังไม่มีรายการ")}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {type === "sale"
          ? tr("พิมพ์ชื่อสินค้า ขนาดยาง หรือบริการในช่องค้นหาด้านบน แล้วกด Enter เพื่อเพิ่มลงบิล")
          : tr("ค้นหาสินค้าที่ซื้อเข้าร้านในช่องด้านบน ระบบจะเพิ่มสต็อกและอัปเดตต้นทุนให้อัตโนมัติ")}
      </p>
    </div>
  );
}
