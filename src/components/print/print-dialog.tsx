"use client";
/**
 * Print preview + print / save-PDF dialog for one transaction.
 * Keep the PrintDialog props signature - other screens use it.
 *
 * The preview is an iframe of the real /print route (same page the printer gets), scaled to fit.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDown, FileText, Minus, Plus, Printer, ReceiptText, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PAPER_LABELS, type PaperSize, type PrintKind, type TransactionType } from "@shared/contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { tr, trc } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PAPER_SIZES, PAPER_WIDTH_PX, isThermal } from "./doc-model";

export interface PrintDialogProps {
  transactionId: string;
  transactionType: TransactionType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Radix Select cannot use "" as an item value. */
const SYSTEM_DEFAULT = "__system_default__";

const KIND_OPTIONS: Record<TransactionType, { value: PrintKind; label: string; hint: string; icon: typeof ReceiptText }[]> = {
  sale: [
    { value: "receipt", label: tr("ใบเสร็จรับเงิน"), hint: tr("ลูกค้าชำระเงินแล้ว"), icon: ReceiptText },
    { value: "invoice", label: tr("ใบแจ้งหนี้ / ใบส่งของ"), hint: tr("ส่งของ / วางบิล เก็บเงินภายหลัง"), icon: FileText },
  ],
  purchase: [{ value: "purchase", label: tr("ใบบันทึกการซื้อ"), hint: tr("เก็บเป็นหลักฐานการซื้อสินค้าเข้าร้าน"), icon: FileText }],
};

/** Paper glyph size (px) for the option cards. */
export const PAPER_GLYPH: Record<PaperSize, { w: number; h: number }> = {
  "80mm": { w: 11, h: 24 },
  "58mm": { w: 8, h: 24 },
  a4: { w: 17, h: 24 },
  a5: { w: 13, h: 18 },
};

/** Two-line card label: size + what it is (the full PAPER_LABELS name is the tooltip). */
export const PAPER_CARD: Record<PaperSize, [string, string]> = {
  "80mm": [tr("80 มม."), tr("ม้วนความร้อน")],
  "58mm": [tr("58 มม."), tr("ม้วนความร้อน")],
  a4: ["A4", tr("เต็มแผ่น")],
  a5: ["A5", tr("ครึ่งแผ่น A4")],
};

export function PrintDialog({ transactionId, transactionType, open, onOpenChange }: PrintDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PrintDialogBody transactionId={transactionId} transactionType={transactionType} onOpenChange={onOpenChange} />}
    </Dialog>
  );
}

function PrintDialogBody({ transactionId, transactionType, onOpenChange }: Omit<PrintDialogProps, "open">) {
  const settingsQ = useQuery({ queryKey: ["settings", "get"], queryFn: () => api.settings.get() });
  const txQ = useQuery({ queryKey: ["transactions", "get", transactionId], queryFn: () => api.transactions.get(transactionId), enabled: !!transactionId });
  const printersQ = useQuery({ queryKey: ["print", "printers"], queryFn: () => api.print.printers(), staleTime: 60_000 });

  const defaults = settingsQ.data?.print;
  const tx = txQ.data;
  const type: TransactionType = tx?.type ?? transactionType;

  // User choices; null = use the default (from settings / the bill).
  const [kindChoice, setKind] = useState<PrintKind | null>(null);
  const [paperChoice, setPaper] = useState<PaperSize | null>(null);
  const [printerChoice, setPrinter] = useState<string | null>(null);
  const [copiesChoice, setCopies] = useState<number | null>(null);

  const kind: PrintKind = type === "purchase" ? "purchase" : (kindChoice ?? (tx?.paymentStatus === "unpaid" ? "invoice" : "receipt"));
  const paper: PaperSize = paperChoice ?? defaults?.defaultPaper ?? "80mm";
  const printerName = printerChoice ?? defaults?.printerName ?? "";
  const copies = copiesChoice ?? defaults?.copies ?? 1;

  const printM = useMutation({
    mutationFn: () => api.print.print({ transactionId, kind, paper, printerName, copies }),
    onSuccess: (r) => {
      if (r.printed) {
        toast.success(tr("ส่งเอกสารไปที่เครื่องพิมพ์แล้ว"), { description: tr("{0} · {1} ชุด", PAPER_LABELS[paper], copies) });
        onOpenChange(false);
      } else if (r.error === "ยกเลิกการพิมพ์") {
        toast.info(tr("ยกเลิกการพิมพ์"));
      } else {
        toast.error(r.error ? tr(r.error) : tr("พิมพ์ไม่สำเร็จ"));
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pdfM = useMutation({
    mutationFn: () => api.print.savePdf({ transactionId, kind, paper }),
    onSuccess: (r) => {
      if (r) toast.success(tr("บันทึกไฟล์ PDF แล้ว"), { description: r.path.split(/[\\/]/).pop() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const busy = printM.isPending || pdfM.isPending;

  const printBtn = useRef<HTMLButtonElement>(null);
  const partyName = tx ? (tx.customer?.name ?? tx.contactName) : null;

  return (
    <DialogContent
      className="flex h-[min(760px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(980px,calc(100%-2rem))]"
      data-shot="print-dialog"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        printBtn.current?.focus();
      }}
    >
      <DialogHeader className="border-b px-5 pt-4 pb-3.5">
        <DialogTitle className="text-lg">{tr("พิมพ์เอกสาร")}</DialogTitle>
        <DialogDescription className="truncate">
          {tx ? (
            <>
              <span className="font-medium text-foreground">{tx.docNo}</span>
              {partyName ? ` · ${partyName}` : ""}
              {tx.status === "void" ? tr(" · บิลนี้ถูกยกเลิกแล้ว") : ""}
            </>
          ) : (
            tr("ดูตัวอย่างก่อนพิมพ์ เลือกเอกสาร ขนาดกระดาษ และเครื่องพิมพ์")
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1">
        <PrintPreview src={`/print/?id=${encodeURIComponent(transactionId)}&kind=${kind}&paper=${paper}&lang=${defaults?.documentLanguage ?? "th"}`} paper={paper} />

        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l px-4 py-4">
          <OptionGroup label={tr("เอกสาร")}>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as PrintKind)} className="gap-2">
              {KIND_OPTIONS[type].map((o) => (
                <ChoiceCard key={o.value} id={`print-kind-${o.value}`} value={o.value} active={kind === o.value}>
                  <o.icon className={cn("size-5 shrink-0", kind === o.value ? "text-primary" : "text-muted-foreground")} />
                  <span className="min-w-0">
                    <span className="block text-sm leading-snug font-medium">{o.label}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{o.hint}</span>
                  </span>
                </ChoiceCard>
              ))}
            </RadioGroup>
          </OptionGroup>

          <OptionGroup label={tr("ขนาดกระดาษ")}>
            <RadioGroup value={paper} onValueChange={(v) => setPaper(v as PaperSize)} className="grid-cols-2 gap-2">
              {PAPER_SIZES.map((p) => (
                <ChoiceCard key={p} id={`print-paper-${p}`} value={p} active={paper === p} compact shot={`print-paper-${p}`}>
                  <span className="flex h-7 w-5 shrink-0 items-end justify-center">
                    <span
                      className={cn("rounded-xs border-[1.5px] bg-background", paper === p ? "border-primary" : "border-muted-foreground/45")}
                      style={{ width: PAPER_GLYPH[p].w, height: PAPER_GLYPH[p].h }}
                    />
                  </span>
                  <span className="min-w-0" title={PAPER_LABELS[p]}>
                    <span className="block text-sm leading-snug font-medium">{PAPER_CARD[p][0]}</span>
                    <span className="block truncate text-xs leading-snug text-muted-foreground">{PAPER_CARD[p][1]}</span>
                  </span>
                </ChoiceCard>
              ))}
            </RadioGroup>
          </OptionGroup>

          <OptionGroup
            label={tr("เครื่องพิมพ์")}
            action={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => void printersQ.refetch()}
                disabled={printersQ.isFetching}
              >
                <RefreshCw className={cn(printersQ.isFetching && "animate-spin")} />
                {tr("ค้นหาใหม่")}
              </Button>
            }
          >
            <PrinterSelect
              value={printerName}
              onChange={setPrinter}
              query={printersQ}
              hint={defaults?.silent ? tr("กด “พิมพ์” แล้วส่งไปที่เครื่องพิมพ์ทันที") : tr("กด “พิมพ์” แล้วจะมีหน้าต่างพิมพ์ของระบบให้ตรวจสอบอีกครั้ง")}
            />
          </OptionGroup>

          <section className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">{tr("จำนวนสำเนา")}</h3>
            <CopiesStepper value={copies} onChange={setCopies} />
          </section>
        </aside>
      </div>

      <DialogFooter className="m-0 items-center rounded-b-xl px-5 py-3.5">
        {tx?.status === "void" && (
          <span className="mr-auto flex items-center gap-1.5 text-sm text-muted-foreground">
            <TriangleAlert className="size-4 text-warning" />
            {tr("เอกสารจะมีคำว่า “ยกเลิก” พิมพ์ทับ")}
          </span>
        )}
        <Button type="button" variant="outline" size="lg" className="min-w-20" onClick={() => onOpenChange(false)}>
          {tr("ปิด")}
        </Button>
        <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => pdfM.mutate()} data-shot="print-pdf">
          {pdfM.isPending ? <Spinner /> : <FileDown />}
          {tr("บันทึกเป็น PDF")}
        </Button>
        <Button ref={printBtn} type="button" size="lg" className="min-w-32" disabled={busy} onClick={() => printM.mutate()} data-shot="print-submit">
          {printM.isPending ? <Spinner /> : <Printer />}
          {printM.isPending ? tr("กำลังพิมพ์…") : tr("พิมพ์")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function OptionGroup({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex h-6 items-center justify-between">
        <h3 className="text-sm font-medium">{label}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ChoiceCard({
  id,
  value,
  active,
  compact,
  shot,
  children,
}: {
  id: string;
  value: string;
  active: boolean;
  compact?: boolean;
  shot?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      data-shot={shot}
      className={cn(
        "relative flex cursor-pointer items-center gap-2.5 rounded-lg border transition-colors hover:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        compact ? "min-h-13 px-2.5 py-1.5" : "px-3 py-2",
        active && "border-primary/50 bg-primary/5 ring-1 ring-primary/30 hover:bg-primary/[0.07] dark:bg-primary/10",
      )}
    >
      {/* Invisible radio covering the card: the whole card is the click / focus target. */}
      <RadioGroupItem id={id} value={value} className="absolute inset-0 size-auto rounded-lg opacity-0 after:hidden" />
      {children}
    </label>
  );
}

export function PrinterSelect({
  value,
  onChange,
  query,
  hint,
}: {
  value: string;
  onChange: (name: string) => void;
  query: { data?: { name: string; displayName: string; isDefault: boolean }[]; isPending: boolean; isError: boolean };
  /** Shown when there is nothing to warn about. */
  hint: string;
}) {
  const printers = query.data ?? [];
  const known = !value || printers.some((p) => p.name === value);
  return (
    <>
      <Select value={value || SYSTEM_DEFAULT} onValueChange={(v) => onChange(v === SYSTEM_DEFAULT ? "" : v)}>
        <SelectTrigger className="h-9 w-full" data-shot="print-printer">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={SYSTEM_DEFAULT}>{tr("เครื่องพิมพ์เริ่มต้นของระบบ")}</SelectItem>
          {(printers.length > 0 || !known) && <SelectSeparator />}
          {!known && <SelectItem value={value}>{tr("{0} (ไม่พบในเครื่องนี้)", value)}</SelectItem>}
          {printers.map((p) => (
            <SelectItem key={p.name} value={p.name}>
              {p.displayName}
              {p.isDefault ? tr(" (ค่าเริ่มต้น)") : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {query.isPending ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" /> {tr("กำลังค้นหาเครื่องพิมพ์…")}
        </p>
      ) : query.isError ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{tr("ดึงรายชื่อเครื่องพิมพ์ไม่สำเร็จ จะใช้เครื่องพิมพ์เริ่มต้นของระบบ")}</p>
      ) : printers.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{tr("ไม่พบเครื่องพิมพ์ที่ติดตั้งในเครื่องนี้ — ยังบันทึกเป็น PDF ได้")}</p>
      ) : !known ? (
        <p className="mt-1.5 text-xs text-warning-foreground dark:text-warning">{tr("ไม่พบเครื่องพิมพ์ที่ตั้งไว้ กรุณาตรวจสอบการเชื่อมต่อหรือเลือกเครื่องอื่น")}</p>
      ) : (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </>
  );
}

export function CopiesStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.min(10, Math.max(1, Math.round(n)));
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        <Button type="button" variant="outline" size="icon-lg" className="rounded-r-none" onClick={() => onChange(clamp(value - 1))} disabled={value <= 1} aria-label={tr("ลดจำนวนสำเนา")}>
          <Minus />
        </Button>
        <div className="num flex h-9 w-12 items-center justify-center border-y border-input text-base font-medium dark:bg-input/30" aria-live="polite">
          {value}
        </div>
        <Button type="button" variant="outline" size="icon-lg" className="rounded-l-none" onClick={() => onChange(clamp(value + 1))} disabled={value >= 10} aria-label={tr("เพิ่มจำนวนสำเนา")}>
          <Plus />
        </Button>
      </div>
      <span className="text-sm text-muted-foreground">{trc("copies", "ชุด")}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------- preview

type PreviewState = { status: "loading" } | { status: "ready"; width: number; height: number } | { status: "error"; message: string };

/** Scaled live preview of a /print route (the same page the printer gets). */
export function PrintPreview({ src, paper }: { src: string; paper: PaperSize }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [boxWidth, setBoxWidth] = useState(0);

  // New document -> back to loading until the iframe reports in.
  useLayoutEffect(() => setState({ status: "loading" }), [src]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; width?: number; height?: number; message?: string } | null;
      if (d?.source !== "erp-print") return;
      if (d.type === "ready") setState({ status: "ready", width: d.width ?? PAPER_WIDTH_PX[paper], height: d.height ?? 0 });
      else if (d.type === "error") setState({ status: "error", message: d.message ?? tr("แสดงตัวอย่างไม่สำเร็จ") });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [paper]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    setBoxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const onLoad = useCallback(() => {
    // Fallback if the page cannot post a message (should not happen): size from the document itself.
    const doc = frameRef.current?.contentDocument;
    window.setTimeout(() => {
      if (doc?.body?.dataset.printReady === "1") {
        const w = Number(doc.body.dataset.printWidthPx) || PAPER_WIDTH_PX[paper];
        const h = Number(doc.body.dataset.printHeightPx) || doc.documentElement.scrollHeight;
        setState((s) => (s.status === "loading" ? { status: "ready", width: w, height: h } : s));
      }
    }, 1500);
  }, [paper]);

  const paperWidth = state.status === "ready" ? state.width : PAPER_WIDTH_PX[paper];
  const paperHeight = state.status === "ready" ? state.height : Math.round(PAPER_WIDTH_PX[paper] * (isThermal(paper) ? 1.6 : 297 / 210));
  const scale = useMemo(() => {
    const avail = Math.max(120, boxWidth - 48);
    return Math.min(isThermal(paper) ? 1.2 : 1, avail / paperWidth);
  }, [boxWidth, paperWidth, paper]);

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 overflow-y-auto bg-muted/70 dark:bg-black/25" data-shot="print-preview">
      <div className="flex justify-center px-6 py-6">
        <div
          className={cn("relative bg-white shadow-[0_1px_3px_rgba(0,0,0,.12),0_8px_28px_rgba(0,0,0,.10)] transition-opacity", state.status !== "ready" && "opacity-0")}
          style={{ width: Math.round(paperWidth * scale), height: Math.round(paperHeight * scale) }}
        >
          <iframe
            key={src}
            ref={frameRef}
            src={src}
            title={tr("ตัวอย่างก่อนพิมพ์")}
            onLoad={onLoad}
            scrolling="no"
            tabIndex={-1}
            className="absolute top-0 left-0 origin-top-left border-0 bg-white"
            style={{ width: paperWidth, height: paperHeight, transform: `scale(${scale})` }}
          />
        </div>
      </div>
      {state.status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-6" />
          {tr("กำลังเตรียมตัวอย่าง…")}
        </div>
      )}
      {state.status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="max-w-sm rounded-xl border bg-card p-5 text-center shadow-sm">
            <TriangleAlert className="mx-auto size-6 text-warning" />
            <p className="mt-2 font-medium">{tr("แสดงตัวอย่างไม่ได้")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- button

export type PrintButtonProps = Omit<React.ComponentProps<typeof Button>, "type"> & {
  transactionId: string;
  transactionType: TransactionType;
};

/** Button that opens the PrintDialog for one transaction. Default look: outline "พิมพ์" with a printer icon. */
export function PrintButton({ transactionId, transactionType, children, onClick, variant = "outline", ...buttonProps }: PrintButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        data-shot="print-open"
        {...buttonProps}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) setOpen(true);
        }}
      >
        {children ?? (
          <>
            <Printer />
            {tr("พิมพ์")}
          </>
        )}
      </Button>
      <PrintDialog transactionId={transactionId} transactionType={transactionType} open={open} onOpenChange={setOpen} />
    </>
  );
}
