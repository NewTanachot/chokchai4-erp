"use client";
/**
 * The print handshake shared by every printable route (/print/, /print/payslip/).
 *
 * Used by electron/api/print.ts (hidden window -> printer / PDF) and by preview iframes. When the document, its
 * images and fonts are ready, `document.body.dataset.printReady = "1"` and `data-print-height-mm` holds the measured
 * height (the thermal roll length); on failure `data-print-error` holds a Thai message. Inside an iframe it also posts
 * {source: "erp-print", type: "ready" | "error", width, height} to the parent.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PaperSize } from "@shared/contract";
import { tr } from "@/lib/i18n";
import { isThermal } from "./doc-model";
import { PRINT_CSS, pageNumberRule, pageRule } from "./print-styles";

/** The preview iframe has no preload script: borrow the parent's bridge (same origin). */
export function adoptParentBridge(): void {
  if (typeof window === "undefined" || window.erp) return;
  try {
    if (window.parent !== window && window.parent.erp) window.erp = window.parent.erp;
  } catch {
    /* cross-origin parent: nothing to borrow */
  }
}

/** Rendered inside a preview iframe (no desk background there). Server snapshot: false (no hydration mismatch). */
const isEmbedded = () => window.parent !== window;
const noSubscribe = () => () => {};

function notifyParent(msg: Record<string, unknown>): void {
  try {
    if (window.parent !== window) window.parent.postMessage({ source: "erp-print", ...msg }, window.location.origin);
  } catch {
    /* ignore */
  }
}

async function whenImageReady(img: HTMLImageElement): Promise<void> {
  if (!img.complete) {
    await new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  }
  // A broken logo is hidden rather than printed as a broken-image icon.
  if (img.naturalWidth === 0) img.style.display = "none";
  else await img.decode().catch(() => undefined);
}

async function whenAssetsReady(root: HTMLElement): Promise<void> {
  await Promise.all(Array.from(root.querySelectorAll("img")).map(whenImageReady));
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

export interface PrintDoc {
  docNo: string;
  title: string;
}

/**
 * Renders `children` (the document, once `doc` is known) with the print stylesheet and runs the handshake.
 * `doc` must keep its identity while the document is unchanged (memoise it).
 */
export function PrintShell({ doc, paper, error, extraCss = "", children }: { doc: PrintDoc | null; paper: PaperSize; error: string | null; extraCss?: string; children: React.ReactNode }) {
  const embedded = useSyncExternalStore(noSubscribe, isEmbedded, () => false);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Size of the rendered document, measured once data, images and fonts are ready (null = not yet). */
  const [measured, setMeasured] = useState<{ doc: PrintDoc; widthPx: number; heightPx: number; heightMm: number } | null>(null);
  const size = measured && measured.doc === doc ? measured : null;

  useLayoutEffect(() => {
    document.title = doc ? `${doc.docNo} - ${doc.title}` : tr("พิมพ์เอกสาร");
  }, [doc]);

  // 1) Wait for assets, then measure the sheet.
  useEffect(() => {
    const body = document.body;
    delete body.dataset.printReady;
    if (error) {
      body.dataset.printError = error;
      notifyParent({ type: "error", message: error });
      return;
    }
    delete body.dataset.printError;
    if (!doc || !rootRef.current) return;
    let cancelled = false;
    const root = rootRef.current;
    void whenAssetsReady(root).then(() => {
      if (cancelled) return;
      const sheet = root.querySelector<HTMLElement>("[data-print-sheet]") ?? root;
      const rect = sheet.getBoundingClientRect();
      setMeasured({ doc, widthPx: Math.ceil(rect.width), heightPx: Math.ceil(rect.height), heightMm: Math.ceil((rect.height * 25.4) / 96) + 1 });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, error]);

  // 2) Announce readiness only after the measured @page size (thermal roll length) has been committed to the DOM.
  useEffect(() => {
    if (!size) return;
    const body = document.body;
    body.dataset.printHeightMm = String(size.heightMm);
    body.dataset.printWidthPx = String(size.widthPx);
    body.dataset.printHeightPx = String(size.heightPx);
    body.dataset.printDocNo = size.doc.docNo;
    const raf = requestAnimationFrame(() => {
      body.dataset.printReady = "1";
      notifyParent({ type: "ready", width: size.widthPx, height: size.heightPx });
    });
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const thermalHeightMm = size && isThermal(paper) ? size.heightMm : undefined;

  return (
    <div data-print-root className={`pd-root${embedded ? "" : " pd-desk"}`} ref={rootRef}>
      <style>{[PRINT_CSS, extraCss, pageRule(paper, thermalHeightMm), doc ? pageNumberRule(paper, doc.docNo) : ""].join("\n")}</style>
      {error ? (
        <div className="pd-error" role="alert">
          <b>{tr("ไม่สามารถแสดงเอกสารได้")}</b>
          <div>{error}</div>
        </div>
      ) : doc ? (
        children
      ) : null}
    </div>
  );
}
