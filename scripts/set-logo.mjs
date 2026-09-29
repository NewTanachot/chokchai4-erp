// App logo / icon generator.
//   npm run logo -- path/to/logo.png   -> uses your logo (trims white border, crops to a circle)
//   npm run logo                        -> regenerates from build/logo-source.* (or the built-in placeholder badge)
// Writes:
//   build/icon.png      1024², macOS: the round badge on a navy rounded-square tile with Apple's icon grid margins
//                       (824² body), so the Dock shows it the same size and shape as other apps
//   build/icon-win.png  1024², Windows: the same tile with small margins (taskbar / Start menu / installer)
//   public/logo.png     512², in-app logo: the round badge on transparent
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const noCircle = process.argv.includes("--no-circle");
fs.mkdirSync(path.join(root, "build"), { recursive: true });
fs.mkdirSync(path.join(root, "public"), { recursive: true });

const NAVY = "#2b2e55";
const existingSource = fs.readdirSync(path.join(root, "build")).find((f) => /^logo-source\.(png|jpe?g|webp)$/i.test(f));
const src = arg ? path.resolve(arg) : existingSource ? path.join(root, "build", existingSource) : null;

function placeholderSvg() {
  const lugs = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return `<circle cx="${512 + Math.cos(a) * 78}" cy="${512 + Math.sin(a) * 78}" r="18" fill="${NAVY}"/>`;
  }).join("");
  const treads = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * 360;
    return `<rect x="506" y="262" width="12" height="44" rx="4" fill="#d9dbe4" transform="rotate(${a} 512 512)"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4f5f8"/><stop offset="0.45" stop-color="#c9ccd6"/>
      <stop offset="0.55" stop-color="#e6e8ee"/><stop offset="1" stop-color="#aeb2bf"/>
    </linearGradient>
  </defs>
  <circle cx="512" cy="512" r="450" fill="url(#silver)" stroke="${NAVY}" stroke-width="30"/>
  <circle cx="512" cy="512" r="405" fill="none" stroke="${NAVY}" stroke-width="8"/>
  <circle cx="512" cy="512" r="262" fill="${NAVY}"/>
  ${treads}
  <circle cx="512" cy="512" r="190" fill="${NAVY}" stroke="#d9dbe4" stroke-width="10"/>
  <circle cx="512" cy="512" r="150" fill="url(#silver)"/>
  <circle cx="512" cy="512" r="112" fill="none" stroke="${NAVY}" stroke-width="10"/>
  ${lugs}
  <circle cx="512" cy="512" r="34" fill="${NAVY}"/>
  <circle cx="512" cy="512" r="14" fill="#d9dbe4"/>
</svg>`;
}

/** The round badge, `size`² PNG, transparent outside the circle. */
async function badgeFromLogo(file, size) {
  const trimmed = await sharp(file).flatten({ background: "#ffffff" }).trim({ threshold: 18 }).toBuffer();
  const { width, height } = await sharp(trimmed).metadata();
  const side = Math.max(width, height);
  let square = await sharp(trimmed)
    .extend({
      top: Math.floor((side - height) / 2),
      bottom: Math.ceil((side - height) / 2),
      left: Math.floor((side - width) / 2),
      right: Math.ceil((side - width) / 2),
      background: "#ffffff",
    })
    .resize(size, size)
    .png()
    .toBuffer();
  if (!noCircle) {
    const r = size / 2;
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - 1}" fill="#fff"/></svg>`);
    square = await sharp(square).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  }
  return square;
}

/** Apple-style "squircle" (superellipse, n = 5) path of a `size`² square at (x, y). */
function squirclePath(x, y, size, n = 5) {
  const r = size / 2;
  const pts = [];
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([x + r + r * Math.sign(c) * Math.abs(c) ** (2 / n), y + r + r * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return `M${pts.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join("L")}Z`;
}

/**
 * 1024² tile: navy gradient body (`body`² at the centre, superellipse or rounded square), soft drop shadow, the badge
 * (`badgeScale` of the body) in the middle.
 */
async function tile(badge, { body, shape, badgeScale }) {
  const off = (1024 - body) / 2;
  const d = shape === "squircle" ? squirclePath(off, off, body) : null;
  const shapeEl = (attrs) =>
    d ? `<path d="${d}" ${attrs}/>` : `<rect x="${off}" y="${off}" width="${body}" height="${body}" rx="${body * 0.2}" ${attrs}/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b4079"/><stop offset="1" stop-color="#1d2044"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.3" r="0.7">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${body * 0.012}" stdDeviation="${body * 0.014}" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  ${shapeEl('fill="url(#bg)" filter="url(#shadow)"')}
  ${shapeEl('fill="url(#glow)"')}
</svg>`;
  const size = Math.round(body * badgeScale);
  const b = await sharp(badge).resize(size, size).png().toBuffer();
  // Shadow under the badge so the silver disc lifts off the navy tile.
  const r = size / 2;
  const badgeShadow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${size * 0.02}"/></filter></defs>
  <circle cx="512" cy="${512 + size * 0.018}" r="${r}" fill="#000" fill-opacity="0.45" filter="url(#s)"/>
</svg>`);
  const pos = Math.round(512 - size / 2);
  return sharp(Buffer.from(svg))
    .composite([{ input: badgeShadow }, { input: b, left: pos, top: pos }])
    .png()
    .toBuffer();
}

const badge = src ? await badgeFromLogo(src, 1024) : await sharp(Buffer.from(placeholderSvg())).extract({ left: 47, top: 47, width: 930, height: 930 }).resize(1024, 1024).png().toBuffer();

await sharp(await tile(badge, { body: 824, shape: "squircle", badgeScale: 0.8 })).toFile(path.join(root, "build", "icon.png"));
await sharp(await tile(badge, { body: 960, shape: "rounded", badgeScale: 0.82 })).toFile(path.join(root, "build", "icon-win.png"));
// Same framing as before (the badge at 900/1024 with a transparent margin), so the in-app logo keeps its size.
const framed = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp(badge).resize(900, 900).png().toBuffer(), left: 62, top: 62 }])
  .png()
  .toBuffer();
await sharp(framed).resize(512, 512).png().toFile(path.join(root, "public", "logo.png"));
if (src && arg) {
  const dest = path.join(root, "build", "logo-source" + path.extname(src).toLowerCase());
  if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
}
console.log(`Logo written: build/icon.png, build/icon-win.png, public/logo.png ${src ? `(from ${path.relative(root, src)})` : "(placeholder)"}`);
