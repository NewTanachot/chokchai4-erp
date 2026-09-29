/**
 * Stylesheet for the /print route. Plain CSS (not theme tokens): printed documents are always
 * black on white, whatever the app theme is. Class prefix "pd-".
 */
import type { PaperSize } from "@shared/contract";
import { tr } from "@/lib/i18n";

/** Page margins of sheet papers (mm) - shared with electron/api/print.ts via the page's @page rule. */
export const SHEET_MARGIN_MM: Record<"a4" | "a5", { v: number; h: number }> = {
  a4: { v: 12, h: 14 },
  a5: { v: 8, h: 9 },
};

export const PRINT_CSS = /* css */ `
html, body {
  background: #fff !important;
  color: #000 !important;
  color-scheme: light !important;
}
body { margin: 0; line-height: 1.45; }
/* Nothing but the document: no toasts / dev overlays. */
[data-sonner-toaster], section[aria-label^="Notifications"], nextjs-portal { display: none !important; }
::-webkit-scrollbar { width: 0; height: 0; }

.pd-root { color: #000; font-family: "IBM Plex Sans Thai", ui-sans-serif, system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pd-root *, .pd-root *::before, .pd-root *::after { border-color: #000; }
.pd-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.pd-center { text-align: center; }
.pd-r { text-align: right; }
.pd-c { text-align: center; }
.pd-pre { white-space: pre-line; }
.pd-b { font-weight: 700; }
.pd-nowrap { white-space: nowrap; }
.pd-dot { color: #777; }

/* Desk background when the page is opened on its own in a wide window (not printed). */
@media screen {
  .pd-desk { min-height: 100vh; background: #e9e9ec; padding: 24px 16px 40px; }
  .pd-desk .pd-paper { margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08); }
}

.pd-error { max-width: 420px; margin: 48px auto; padding: 20px 24px; background: #fff; border: 1px solid #ddd; border-radius: 12px; font-size: 15px; text-align: center; }
.pd-error b { display: block; margin-bottom: 4px; font-size: 16px; }

/* ---------- Void watermark ---------- */
.pd-void-mark {
  position: absolute; inset: 0; z-index: 5; pointer-events: none; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.pd-void-mark span {
  transform: rotate(-32deg); white-space: nowrap; line-height: 1.15;
  font-weight: 700; color: rgba(0,0,0,.16); border: .06em solid rgba(0,0,0,.16);
  border-radius: .08em; padding: .02em .28em .06em; letter-spacing: .04em;
}
/* Sheets: repeat on every printed page. Thermal rolls are one page, so the mark stays centred on the receipt. */
@media print { .pd-sheet .pd-void-mark { position: fixed; } }

/* ---------- Thermal receipt (80 / 58 mm roll) ---------- */
.pd-thermal {
  position: relative; box-sizing: border-box; background: #fff; overflow: hidden;
  width: 80mm; padding: 3mm 4mm 7mm; font-size: 12px; line-height: 1.42; font-weight: 500;
}
.pd-thermal.pd-58mm { width: 58mm; padding: 2.5mm 5mm 6mm; font-size: 10.5px; }
.pd-thermal .pd-void-mark span { font-size: 62px; color: rgba(0,0,0,.2); border-color: rgba(0,0,0,.2); }
.pd-thermal.pd-58mm .pd-void-mark span { font-size: 44px; }
.pd-t-head { text-align: center; }
.pd-t-logo { display: block; margin: 0 auto 1.2mm; width: 17mm; height: 17mm; object-fit: contain; }
.pd-58mm .pd-t-logo { width: 13mm; height: 13mm; }
.pd-t-shop { font-size: 1.32em; font-weight: 700; line-height: 1.3; }
.pd-t-sub { font-size: .92em; }
.pd-t-title { text-align: center; font-weight: 700; font-size: 1.14em; line-height: 1.35; margin: .4mm 0 1.2mm; }
.pd-sep { border: 0; border-top: 1px dashed #000; margin: 1.6mm 0; height: 0; }
.pd-kv { display: flex; justify-content: space-between; align-items: baseline; gap: 3mm; }
.pd-kv > :first-child { flex: none; white-space: nowrap; }
.pd-kv > :last-child { min-width: 0; text-align: right; overflow-wrap: anywhere; }
.pd-t-colhead { display: flex; justify-content: space-between; font-weight: 700; }
.pd-t-item { margin-top: 1.1mm; break-inside: avoid; }
.pd-t-item-name { font-weight: 600; overflow-wrap: anywhere; }
.pd-t-item-note { padding-left: 3mm; font-size: .92em; overflow-wrap: anywhere; }
.pd-t-calc { display: flex; justify-content: space-between; gap: 2mm; padding-left: 3mm; }
.pd-t-grand {
  display: flex; justify-content: space-between; align-items: baseline; gap: 2mm;
  font-weight: 700; font-size: 1.36em; line-height: 1.35;
  border-top: 3px double #000; border-bottom: 3px double #000; padding: .9mm 0; margin: 1.4mm 0 1.2mm;
}
.pd-t-vatnote { text-align: center; font-size: .92em; }
.pd-t-flag { border: 2px solid #000; text-align: center; font-weight: 700; font-size: 1.12em; padding: .6mm 1mm; margin: 1.6mm 0 .6mm; }
.pd-t-flag small { display: block; font-size: .82em; font-weight: 600; }
.pd-t-note { margin-top: 1.2mm; overflow-wrap: anywhere; white-space: pre-line; }
.pd-t-foot { text-align: center; white-space: pre-line; font-weight: 600; margin-top: .4mm; }

/* ---------- A4 / A5 sheet ---------- */
.pd-sheet {
  position: relative; box-sizing: border-box; background: #fff; color: #111;
  display: flex; flex-direction: column;
  width: 210mm; min-height: 297mm; padding: 12mm 14mm; font-size: 12px; line-height: 1.5; font-weight: 400;
}
.pd-sheet.pd-a5 { width: 148mm; min-height: 210mm; padding: 8mm 9mm; font-size: 10px; }
.pd-sheet .pd-void-mark span { font-size: 150px; }
.pd-sheet.pd-a5 .pd-void-mark span { font-size: 104px; }
/* Printed: the @page margins replace the on-screen padding and the sheet fills the printable width. Selectors must
   out-rank ".pd-sheet.pd-a5" above, or the A5 sheet keeps its screen width and Chromium shrinks it to fit. */
@media print {
  .pd-sheet, .pd-sheet.pd-a4, .pd-sheet.pd-a5 { width: auto; padding: 0; }
  .pd-sheet.pd-a4 { min-height: calc(297mm - 24mm - 2mm); }
  .pd-sheet.pd-a5 { min-height: calc(210mm - 16mm - 2mm); }
}
.pd-muted { color: #555; }
.pd-s-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; padding-bottom: 3.5mm; border-bottom: 2px solid #111; }
.pd-s-shop { display: flex; gap: 4mm; min-width: 0; }
.pd-s-logo { flex: none; width: 21mm; height: 21mm; object-fit: contain; }
.pd-a5 .pd-s-logo { width: 15mm; height: 15mm; }
.pd-s-shopname { font-size: 1.62em; font-weight: 700; line-height: 1.25; margin-bottom: .6mm; }
.pd-s-shopinfo { color: #333; }
/* A5 is too narrow for "phone · LINE" on one line: one per line instead of a dangling separator. */
.pd-a5 .pd-s-contact > span { display: block; }
.pd-a5 .pd-s-contact .pd-dot { display: none; }
.pd-s-doc { flex: none; max-width: 48%; text-align: right; }
.pd-s-title { font-size: 1.72em; font-weight: 700; line-height: 1.25; }
.pd-s-meta { margin: 2mm 0 0 auto; border-collapse: collapse; }
.pd-s-meta th { text-align: left; font-weight: 400; color: #555; padding: 0 4mm 0 0; white-space: nowrap; }
.pd-s-meta td { text-align: right; font-weight: 600; padding: 0; white-space: nowrap; }
.pd-s-voidbar { margin-top: 3mm; border: 1.5px solid #111; border-radius: 1.5mm; padding: 1.5mm 3mm; font-weight: 700; text-align: center; }
.pd-s-voidbar span { font-weight: 400; }
.pd-s-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 4mm; }
.pd-s-parties.pd-one { grid-template-columns: 1fr; }
.pd-s-box { border: 1px solid #9a9a9a; border-radius: 1.8mm; padding: 2.2mm 3.5mm 2.6mm; min-width: 0; }
.pd-s-label { font-size: .86em; font-weight: 600; color: #555; margin-bottom: .4mm; }
.pd-s-partyname { font-size: 1.12em; font-weight: 700; line-height: 1.35; }
.pd-s-dl { display: grid; grid-template-columns: auto 1fr; column-gap: 3mm; margin: .6mm 0 0; }
.pd-s-dl dt { color: #555; white-space: nowrap; }
.pd-s-dl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.pd-s-flag { display: inline-block; margin-top: 1mm; border: 1.5px solid #111; border-radius: 1mm; padding: 0 2.2mm; font-weight: 700; }
.pd-s-items { width: 100%; border-collapse: collapse; margin-top: 4.5mm; }
.pd-s-items thead { display: table-header-group; }
.pd-s-items th {
  background: #eeeef0; color: #111; font-weight: 600; white-space: nowrap;
  border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; padding: 1.5mm 2mm; text-align: left;
}
.pd-s-items th.pd-r { text-align: right; }
.pd-s-items th.pd-c { text-align: center; }
.pd-s-items td { padding: 1.5mm 2mm; border-bottom: 1px solid #d6d6d6; vertical-align: top; }
.pd-s-items tr { break-inside: avoid; }
.pd-s-items tbody tr:last-child td { border-bottom: 1.5px solid #111; }
.pd-s-items .pd-s-itemnote { font-size: .88em; color: #555; }
.pd-s-summary { display: grid; grid-template-columns: 1fr 74mm; gap: 6mm; margin-top: 3mm; break-inside: avoid; }
.pd-a5 .pd-s-summary { grid-template-columns: 1fr 56mm; gap: 4mm; }
.pd-s-words { background: #f2f2f4; border-radius: 1.5mm; padding: 1.8mm 3mm; font-weight: 600; text-align: center; }
.pd-s-note { margin-top: 2.5mm; white-space: pre-line; overflow-wrap: anywhere; }
.pd-s-totals { width: 100%; border-collapse: collapse; }
.pd-s-totals td { padding: .9mm 2mm; }
.pd-s-totals td:last-child { text-align: right; }
.pd-s-totals td.pd-s-subhead { text-align: left; padding-top: 1.4mm; }
.pd-s-totals .pd-s-sub td { color: #444; font-size: .92em; padding-top: 0; }
.pd-s-grand td { border-top: 1.5px solid #111; border-bottom: 3px double #111; font-weight: 700; font-size: 1.18em; padding: 1.6mm 2mm; }
.pd-s-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: auto; padding-top: 14mm; break-inside: avoid; }
.pd-a5 .pd-s-signs { gap: 8mm; padding-top: 9mm; }
.pd-s-sign { text-align: center; width: 100%; max-width: 76mm; justify-self: center; }
.pd-s-signrow { display: flex; align-items: flex-end; gap: 1.5mm; }
.pd-s-dots { flex: 1; border-bottom: 1px dotted #333; height: 1em; margin-bottom: .32em; }
.pd-s-signname { padding: 0 8mm; margin: 2.2mm 0 .8mm; }
.pd-s-signdate { padding: 0 12mm; margin-top: .6mm; }
.pd-s-foot { margin-top: 5mm; padding-top: 2.4mm; border-top: 1px solid #cfcfcf; text-align: center; color: #444; white-space: pre-line; }
`;

/** @page rule for a paper. Thermal height is only known after layout (see measured-height override). */
export function pageRule(paper: PaperSize, thermalHeightMm?: number): string {
  if (paper === "a4" || paper === "a5") {
    const m = SHEET_MARGIN_MM[paper];
    return `@page { size: ${paper.toUpperCase()} portrait; margin: ${m.v}mm ${m.h}mm; }`;
  }
  const w = paper === "80mm" ? 80 : 58;
  return thermalHeightMm ? `@page { size: ${w}mm ${thermalHeightMm}mm; margin: 0; }` : `@page { margin: 0; }`;
}

/**
 * Running "<docNo> · หน้า x/y" in the bottom-right page margin of A4/A5 sheets (CSS page-margin boxes), so a
 * multi-page document can be put back together. Thermal rolls are a single page: nothing.
 */
export function pageNumberRule(paper: PaperSize, docNo: string): string {
  if (paper !== "a4" && paper !== "a5") return "";
  const label = docNo.replace(/["\\\r\n]/g, "");
  const page = tr("หน้า").replace(/["\\\r\n]/g, "");
  const pt = paper === "a4" ? 7.5 : 6.5;
  return `@page { @bottom-right { content: "${label}  ·  ${page} " counter(page) "/" counter(pages); font-family: "IBM Plex Sans Thai", sans-serif; font-size: ${pt}pt; color: #666; } }`;
}
