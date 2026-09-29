import { tr } from "@/lib/i18n";
/** Client-side logo processing: any image -> PNG data URL (max 400 px, < 300 KB) for receipts. */

export const LOGO_MAX_PX = 400;
export const LOGO_MAX_BYTES = 300 * 1024;
const SOURCE_MAX_BYTES = 15 * 1024 * 1024;

/** Approximate decoded size of a data: URL. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function formatBytes(n: number): string {
  if (n < 1024) return tr("{0} ไบต์", n);
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tr("ไฟล์นี้ไม่ใช่รูปภาพ หรือเปิดรูปไม่ได้")));
    img.src = src;
  });
}

function render(img: HTMLImageElement, maxPx: number, type: "image/png" | "image/jpeg", quality?: number): string {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) throw new Error(tr("รูปภาพไม่มีขนาด"));
  const scale = Math.min(1, maxPx / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error(tr("ไม่สามารถประมวลผลรูปภาพได้"));
  if (type === "image/jpeg") {
    // JPEG has no transparency: print on white paper.
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
  }
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(type, quality);
}

/** Downscale + re-encode. PNG first (keeps transparency), smaller PNGs, then JPEG as a last resort. */
export async function processLogo(src: Blob): Promise<string> {
  if (!src.type.startsWith("image/")) throw new Error(tr("กรุณาเลือกไฟล์รูปภาพ (PNG หรือ JPG)"));
  if (src.size > SOURCE_MAX_BYTES) throw new Error(tr("ไฟล์รูปใหญ่เกินไป (เกิน 15 MB) กรุณาเลือกรูปที่เล็กลง"));
  const url = URL.createObjectURL(src);
  try {
    const img = await loadImage(url);
    for (const px of [LOGO_MAX_PX, 320, 256]) {
      const png = render(img, px, "image/png");
      if (dataUrlBytes(png) <= LOGO_MAX_BYTES) return png;
    }
    for (const q of [0.9, 0.8, 0.65]) {
      const jpg = render(img, LOGO_MAX_PX, "image/jpeg", q);
      if (dataUrlBytes(jpg) <= LOGO_MAX_BYTES) return jpg;
    }
    throw new Error(tr("รูปมีรายละเอียดมากเกินไป กรุณาเลือกรูปโลโก้ที่เรียบง่ายกว่านี้"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The shop's own logo bundled with the app (public/logo.png). */
export async function loadDefaultLogo(): Promise<string> {
  const res = await fetch("/logo.png");
  if (!res.ok) throw new Error(tr("ไม่พบไฟล์โลโก้ของร้าน"));
  const blob = await res.blob();
  return processLogo(blob.type.startsWith("image/") ? blob : new Blob([blob], { type: "image/png" }));
}
