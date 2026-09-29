"use client";
/**
 * The big search box of the bill form: products and services in one list.
 * Enter / click adds the highlighted item; a barcode scanner (types + Enter) works too.
 */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { Package, Search, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Paged, Product, ProductListQuery, ServiceItem, ServiceItemListQuery, TransactionType } from "@shared/contract";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { formatBaht, formatQty } from "@/lib/format";
import { tr, trc } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useDebounced } from "./hooks";

const GROUP_CLS =
  "**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground";
const ITEM_CLS =
  "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

export type ItemPick = { kind: "product"; product: Product } | { kind: "service"; service: ServiceItem };

const productQuery = (search: string): ProductListQuery => ({ search: search || undefined, limit: search ? 30 : 12 });
const serviceQuery = (search: string): ServiceItemListQuery => ({ search: search || undefined, limit: search ? 20 : 30 });

function exactMatch(products: Product[], q: string): Product | undefined {
  const s = q.trim().toLowerCase();
  return products.find((p) => p.barcode?.toLowerCase() === s || p.sku?.toLowerCase() === s);
}

export function ItemSearch({
  type,
  onPick,
  inputRef,
  className,
}: {
  type: TransactionType;
  onPick: (pick: ItemPick) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const dq = useDebounced(q.trim(), 120);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close when the user clicks anywhere else (focus may already have moved without a blur on this input).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const products = useQuery({
    queryKey: ["products", "list", productQuery(dq)],
    queryFn: () => api.products.list(productQuery(dq)),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const services = useQuery({
    queryKey: ["serviceItems", "list", serviceQuery(dq)],
    queryFn: () => api.serviceItems.list(serviceQuery(dq)),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const productItems = useMemo(() => products.data?.items ?? [], [products.data]);
  const serviceItems = useMemo(() => services.data?.items ?? [], [services.data]);
  // With an empty box show services first (quick picks like ปะยาง); when searching show products first.
  const servicesFirst = dq === "";
  const keys = useMemo(() => {
    const p = productItems.map((x) => `p:${x.id}`);
    const s = serviceItems.map((x) => `s:${x.id}`);
    return servicesFirst ? [...s, ...p] : [...p, ...s];
  }, [productItems, serviceItems, servicesFirst]);

  // Keep the highlight on the first result whenever the results change.
  useEffect(() => {
    setSelected(keys[0] ?? "");
    listRef.current?.scrollTo({ top: 0 });
  }, [keys]);

  const pick = (p: ItemPick) => {
    onPick(p);
    setQ("");
  };

  const pickKey = (key: string) => {
    const [kind, id] = [key.slice(0, 1), key.slice(2)];
    if (kind === "p") {
      const product = productItems.find((x) => x.id === id);
      if (product) pick({ kind: "product", product });
    } else {
      const service = serviceItems.find((x) => x.id === id);
      if (service) pick({ kind: "service", service });
    }
  };

  /** Enter pressed before the debounced search caught up (fast typing / barcode scanner). */
  const pickFresh = async (text: string) => {
    const [pr, sv] = await Promise.all([
      qc.fetchQuery<Paged<Product>>({ queryKey: ["products", "list", productQuery(text)], queryFn: () => api.products.list(productQuery(text)) }),
      qc.fetchQuery<Paged<ServiceItem>>({ queryKey: ["serviceItems", "list", serviceQuery(text)], queryFn: () => api.serviceItems.list(serviceQuery(text)) }),
    ]);
    const exact = exactMatch(pr.items, text);
    if (exact) return pick({ kind: "product", product: exact });
    if (pr.items[0]) return pick({ kind: "product", product: pr.items[0] });
    if (sv.items[0]) return pick({ kind: "service", service: sv.items[0] });
  };

  const loading = open && (products.isFetching || services.isFetching);
  const nothing = !products.isPending && !services.isPending && productItems.length === 0 && serviceItems.length === 0;

  const productGroup = productItems.length ? (
    <CommandPrimitive.Group heading={dq ? tr("สินค้า") : tr("สินค้า (พิมพ์เพื่อค้นหาเพิ่ม)")} className={GROUP_CLS}>
      {productItems.map((p) => {
        const out = p.trackStock && p.stockQty <= 0;
        const low = p.trackStock && !out && p.stockQty <= p.minStock;
        const price = type === "sale" ? p.sellPrice : p.costPrice;
        return (
          <CommandPrimitive.Item key={p.id} value={`p:${p.id}`} onSelect={pickKey} className={ITEM_CLS}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
              <Package className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {p.name}
                {p.spec ? <span className="ml-1.5 font-normal text-muted-foreground">{p.spec}</span> : null}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {[p.sku, p.categoryName].filter(Boolean).join(" · ") || tr("สินค้า")}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="num block font-medium">{formatBaht(price)}</span>
              {p.trackStock ? (
                <span className={cn("num block text-xs", out ? "text-destructive" : low ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
                  {out ? tr("หมดสต็อก") : tr("คงเหลือ {0} {1}", formatQty(p.stockQty), p.unit)}
                </span>
              ) : (
                <span className="block text-xs text-muted-foreground">{tr("ไม่นับสต็อก")}</span>
              )}
            </span>
          </CommandPrimitive.Item>
        );
      })}
    </CommandPrimitive.Group>
  ) : null;

  const serviceGroup = serviceItems.length ? (
    <CommandPrimitive.Group heading={trc("plural", "บริการ")} className={GROUP_CLS}>
      {serviceItems.map((s) => (
        <CommandPrimitive.Item key={s.id} value={`s:${s.id}`} onSelect={pickKey} className={ITEM_CLS}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-chart-2/12 text-chart-2">
            <Wrench className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{s.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{tr("บริการ · ต่อ{0}", s.unit)}</span>
          </span>
          <span className="num shrink-0 text-right font-medium">{type === "sale" ? (s.defaultPrice ? formatBaht(s.defaultPrice) : <span className="text-muted-foreground">{tr("กำหนดราคาเอง")}</span>) : null}</span>
        </CommandPrimitive.Item>
      ))}
    </CommandPrimitive.Group>
  ) : null;

  return (
    <CommandPrimitive
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={setSelected}
      ref={rootRef}
      className={cn("relative", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (q) setQ("");
          else setOpen(false);
          e.preventDefault();
          return;
        }
        if (e.key === "Enter" && q.trim() && q.trim() !== dq) {
          e.preventDefault();
          void pickFresh(q.trim());
        }
        if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) setOpen(true);
      }}
    >
      <div
        className={cn(
          "flex h-12 items-center gap-2 rounded-xl border border-input bg-background px-3.5 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40",
        )}
      >
        {loading ? <Spinner className="size-5 text-muted-foreground" /> : <Search className="size-5 shrink-0 text-muted-foreground" />}
        <CommandPrimitive.Input
          ref={inputRef}
          value={q}
          onValueChange={(v) => {
            setQ(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => setOpen(true)}
          placeholder={tr("ค้นหาสินค้าหรือบริการ… (F2)")}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          data-shot="item-search"
          aria-label={tr("ค้นหาสินค้าหรือบริการ")}
        />
        {q ? (
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setQ("")}
            aria-label={tr("ล้างคำค้นหา")}
          >
            <X className="size-4" />
          </button>
        ) : (
          <Kbd className="hidden sm:inline-flex">F2</Kbd>
        )}
      </div>

      {open ? (
        <div
          className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5"
          // keep focus in the input while clicking a result
          onMouseDown={(e) => e.preventDefault()}
        >
          <CommandPrimitive.List ref={listRef} className="max-h-[min(440px,58vh)] overflow-y-auto overscroll-contain p-1.5">
            {products.isPending || services.isPending ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Spinner /> {tr("กำลังค้นหา…")}
              </div>
            ) : nothing ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {tr("ไม่พบ “{0}”", dq)}
                <div className="mt-1 text-xs">{tr("ลองพิมพ์ชื่อ, ขนาดยาง, รหัสสินค้า หรือใช้ปุ่ม “รายการอื่น ๆ”")}</div>
              </div>
            ) : servicesFirst ? (
              <>
                {serviceGroup}
                {productGroup}
              </>
            ) : (
              <>
                {productGroup}
                {serviceGroup}
              </>
            )}
          </CommandPrimitive.List>
          <div className="flex items-center gap-3 border-t bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> {tr("เลือก")}
            </span>
            <span>
              <Kbd>Enter</Kbd> {tr("เพิ่มลงบิล")}
            </span>
            <span>
              <Kbd>Esc</Kbd> {tr("ปิด")}
            </span>
          </div>
        </div>
      ) : null}
    </CommandPrimitive>
  );
}
