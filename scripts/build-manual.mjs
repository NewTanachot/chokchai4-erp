// Builds the PDF of the user manual: docs/manual/USER_MANUAL.md -> docs/manual/USER_MANUAL.pdf
//
//   node scripts/build-manual.mjs [--md docs/manual/USER_MANUAL.md] [--out docs/manual/USER_MANUAL.pdf] [--keep-html]
//
// The Markdown (the subset the manual uses: headings, paragraphs, nested lists, tables, block quotes, images with an
// italic caption line, **bold**, *italic*, `code`, [links](#anchor)) becomes an A4 print page in the app's Thai font
// (IBM Plex Sans Thai from @fontsource) with a cover, a table of contents and page numbers. Electron prints it until
// the table of contents is stable: each PDF gives the page of every heading (from the PDF outline), the next print
// fills them in. The final PDF then gets its bookmarks / links repaired in place (see patchPdf). Screenshots are
// embedded as JPEG (Chromium would store PNGs as raw pixels, which makes the PDF huge).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { electronBinary, electronEnv } from "./electron-env.mjs";

const root = path.resolve(import.meta.dirname, "..");
const RENDER_FLAG = "--render";

// ---------------------------------------------------------------------------------------------------- Node side

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  const mdPath = path.resolve(root, opt("--md", "docs/manual/USER_MANUAL.md"));
  const outPath = path.resolve(root, opt("--out", mdPath.replace(/\.md$/i, ".pdf")));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "chokchai4-manual-"));
  const doc = parseManual(fs.readFileSync(mdPath, "utf8"), path.dirname(mdPath));

  const jobs = { images: doc.images.map((img) => ({ src: img.file, out: path.join(work, img.jpg) })) };
  let pages = null;
  for (let pass = 1; pass <= 3; pass++) {
    const htmlPath = path.join(work, "manual.html");
    fs.writeFileSync(htmlPath, renderHtml(doc, pages));
    const pdfPath = path.join(work, `pass${pass}.pdf`);
    runElectron({ ...jobs, html: htmlPath, pdf: pdfPath });
    jobs.images = []; // converted once
    const found = headingPages(fs.readFileSync(pdfPath), doc.headings);
    const same = pages && doc.headings.every((t) => pages.get(t.id) === found.get(t.id));
    pages = found;
    if (same) {
      const { pdf, moved, titled } = patchPdf(fs.readFileSync(pdfPath), doc.headings);
      fs.writeFileSync(outPath, pdf);
      const check = headingPages(pdf, doc.headings);
      if (!doc.headings.every((t) => check.get(t.id) === pages.get(t.id))) throw new Error("patched PDF: heading pages changed");
      console.log(`[manual] fixed ${moved} links / bookmarks that pointed to the previous page, ${titled} bookmark titles`);
      console.log(`[manual] ${path.relative(root, outPath)} (${pageCount(fs.readFileSync(outPath))} pages, ${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB)`);
      if (args.includes("--keep-html")) console.log(`[manual] html: ${htmlPath}`);
      else fs.rmSync(work, { recursive: true, force: true });
      return;
    }
  }
  throw new Error("table of contents page numbers did not settle");
}

function runElectron(job) {
  const jobFile = path.join(path.dirname(job.html), "job.json");
  fs.writeFileSync(jobFile, JSON.stringify(job));
  const r = spawnSync(electronBinary(), [path.join(root, "scripts", "build-manual.mjs"), RENDER_FLAG, jobFile], {
    cwd: root,
    env: electronEnv(),
    stdio: "inherit",
  });
  if (r.status !== 0 || !fs.existsSync(job.pdf)) throw new Error("Electron could not print the manual");
}

// ---------------------------------------------------------------------------------------------------- Markdown

/** GitHub-style heading anchor: lower case, punctuation removed, spaces -> "-", duplicates get -1, -2. */
function slugger() {
  const seen = new Set();
  return (text) => {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    let s = base;
    for (let n = 1; seen.has(s); n++) s = `${base}-${n}`;
    seen.add(s);
    return s;
  };
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plainText = (s) => s.replace(/\*\*|`/g, "").trim();

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") throw new Error(`not a PNG: ${file}`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/**
 * Splits the manual into the cover (everything before "## สารบัญ"), the headings (all of them feed the PDF outline;
 * h2 / h3 make the table of contents) and the body HTML. The Markdown table of contents between <!-- toc --> and
 * <!-- /toc --> is dropped: the PDF has its own, with page numbers.
 */
function parseManual(md, baseDir) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const slug = slugger();
  const toc = [];
  const headings = [];
  const images = [];
  const cover = { title: "", lines: [] };
  const out = [];
  let i = 0;

  // Cover: # title, then the lines up to the first "## " heading (its block quote becomes a note on the cover).
  const coverNotes = [];
  while (i < lines.length && !lines[i].startsWith("## ")) {
    const line = lines[i].trim();
    if (line.startsWith("# ")) cover.title = line.slice(2).trim();
    else if (line.startsWith(">")) coverNotes.push(line.replace(/^>\s?/, ""));
    else if (line) cover.lines.push(line);
    i++;
  }
  slug(cover.title);

  const isBlockStart = (l) => /^(#{1,6} |\||>|!\[|<!--|---\s*$)/.test(l) || /^\s*([-*]|\d+\.)\s+/.test(l);

  function parseList(start) {
    // Returns [html, nextIndex]. Items may nest by indentation; continuation lines join the item text.
    const indentOf = (l) => /^(\s*)/.exec(l)[1].length;
    const baseIndent = indentOf(lines[start]);
    const ordered = /^\s*\d+\./.test(lines[start]);
    const items = [];
    let j = start;
    while (j < lines.length) {
      const l = lines[j];
      if (!l.trim()) break;
      const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);
      const ind = indentOf(l);
      if (m && ind === baseIndent) {
        items.push({ text: m[3], children: "" });
        j++;
      } else if (m && ind > baseIndent && items.length) {
        const [html, next] = parseList(j);
        items[items.length - 1].children += html;
        j = next;
      } else if (!m && ind > baseIndent && items.length) {
        items[items.length - 1].text += " " + l.trim();
        j++;
      } else break;
    }
    const tag = ordered ? "ol" : "ul";
    return [`<${tag}>${items.map((it) => `<li>${inline(it.text)}${it.children}</li>`).join("")}</${tag}>`, j];
  }

  function parseTable(start) {
    const row = (l) =>
      l
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
    const head = row(lines[start]);
    let j = start + 2;
    const body = [];
    while (j < lines.length && lines[j].trim().startsWith("|")) body.push(row(lines[j++]));
    const html =
      `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
      body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
      "</tbody></table>";
    return [html, j];
  }

  function figure(alt, src, caption) {
    const file = path.resolve(baseDir, src);
    const { width, height } = pngSize(file);
    // Width on the page: screenshots of the whole window fill the text width; crops (dialogs, menus, documents)
    // keep about their on-screen size. Nothing may be taller than 175 mm, so a figure fits below a heading and some text.
    const fullWidth = 178;
    let mm = width >= 1400 ? fullWidth : Math.max(45, Math.min(fullWidth, (width / 2) * 0.2646 * 0.85));
    mm = Math.min(mm, (175 * width) / height);
    const jpg = `img-${images.length + 1}-${path.basename(file, ".png")}.jpg`;
    images.push({ file, jpg });
    const cap = caption ? `<figcaption>${inline(caption)}</figcaption>` : "";
    return `<figure><img src="${jpg}" alt="${escapeHtml(alt)}" style="width:${mm.toFixed(1)}mm">${cap}</figure>`;
  }

  let inToc = false;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("<!-- toc -->")) {
      inToc = true;
      i++;
      continue;
    }
    if (t.startsWith("<!-- /toc -->")) {
      inToc = false;
      i++;
      continue;
    }
    if (inToc || !t || t.startsWith("<!--")) {
      i++;
      continue;
    }
    const h = /^(#{2,6}) (.+)$/.exec(t);
    if (h) {
      const level = h[1].length;
      const text = plainText(h[2]);
      const id = slug(text);
      if (text === "สารบัญ") {
        i++;
        continue;
      }
      headings.push({ id, level, text });
      if (level <= 3) toc.push({ id, level, text });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^---\s*$/.test(t)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (t.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      const [html, next] = parseTable(i);
      out.push(html);
      i = next;
      continue;
    }
    if (t.startsWith(">")) {
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) quote.push(lines[i++].trim().replace(/^>\s?/, ""));
      out.push(callout(quote));
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(t);
    if (img) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const cap = /^\*([^*].*)\*$/.exec(lines[j]?.trim() ?? "");
      out.push(figure(img[1], img[2], cap ? cap[1] : null));
      i = cap ? j + 1 : i + 1;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const [html, next] = parseList(i);
      out.push(html);
      i = next;
      continue;
    }
    const para = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++].trim());
    const text = para.join(" ");
    out.push(/^\*\*[^*]+\*\*$/.test(text) ? `<p class="lead">${inline(text)}</p>` : `<p>${inline(text)}</p>`);
  }
  cover.notes = coverNotes;
  return { cover, toc, headings, images, body: out.join("\n") };
}

/** Block quote -> callout box; the kind follows its first bold word (เคล็ดลับ / ข้อควรระวัง / หมายเหตุ). */
function callout(lines) {
  const text = lines.join(" ").trim();
  const kind = /^\*\*เคล็ดลับ/.test(text) ? "tip" : /^\*\*ข้อควรระวัง/.test(text) ? "warn" : "note";
  return `<aside class="callout ${kind}"><p>${inline(text)}</p></aside>`;
}

// ---------------------------------------------------------------------------------------------------- HTML

function renderHtml(doc, pages) {
  const font = (w) => pathToFileURL(path.join(root, `node_modules/@fontsource/ibm-plex-sans-thai/${w}.css`)).href;
  const logo = pathToFileURL(path.join(root, "public/logo.png")).href;
  const pageOf = (id) => (pages?.get(id) ?? "");
  const toc = doc.toc
    .map((t) => `<li class="${t.level === 2 ? "toc-ch" : "toc-sec"}"><a href="#${t.id}"><span>${escapeHtml(t.text)}</span><i></i><b>${pageOf(t.id)}</b></a></li>`)
    .join("");
  const [version, ...rest] = doc.cover.lines;
  const coverLines = rest.map((l) => `<p>${inline(l)}</p>`).join("");
  const coverNote = doc.cover.notes.length ? `<p class="cover-note">${inline(doc.cover.notes.join(" "))}</p>` : "";
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.cover.title)}</title>
${[400, 500, 600, 700].map((w) => `<link rel="stylesheet" href="${font(w)}">`).join("\n")}
<style>${CSS}</style>
</head>
<body>
<section class="cover">
  <div class="cover-band">
    <img class="cover-logo" src="${logo}" alt="">
    <div class="cover-kicker">คู่มือการใช้งาน</div>
    <div class="cover-title">${escapeHtml(doc.cover.title.replace(/^คู่มือการใช้งานโปรแกรม\s*/, ""))}</div>
    <div class="cover-version">${inline(version ?? "")}</div>
  </div>
  <div class="cover-body">${coverLines}${coverNote}</div>
</section>
<section class="toc">
  <div class="toc-title">สารบัญ</div>
  <ol>${toc}</ol>
</section>
<main>
${doc.body.replace(/^\s*(<h2[^>]*>.*?<\/h2>\s*<(ul|ol|p)>[\s\S]*?<\/\2>)/, '<div class="keep">$1</div>')}
</main>
</body>
</html>`;
}

const CSS = `
@page {
  size: A4;
  margin: 18mm 16mm 20mm 16mm;
  @bottom-left { content: "คู่มือการใช้งาน · โชคชัย 4 ยางยนต์ 2002 ERP"; font: 8pt "IBM Plex Sans Thai", sans-serif; color: #7a7f99; }
  @bottom-right { content: "หน้า " counter(page) " / " counter(pages); font: 8pt "IBM Plex Sans Thai", sans-serif; color: #7a7f99; }
}
@page :first { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
:root { --navy: #2b2e55; --navy-2: #1d2042; --ink: #1c1e2b; --muted: #5d6178; --line: #d9dbe5; --soft: #f3f4f8; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "IBM Plex Sans Thai", sans-serif; font-size: 10.5pt; line-height: 1.7; color: var(--ink); }
a { color: inherit; text-decoration: none; }
p { margin: 0 0 2.4mm; orphans: 2; widows: 2; }
strong { font-weight: 600; }
code { font-family: Menlo, Consolas, monospace; font-size: 8.6pt; background: var(--soft); border: 0.2mm solid var(--line); border-radius: 1mm; padding: 0 1mm; overflow-wrap: anywhere; }

/* cover */
.cover { height: 297mm; display: flex; flex-direction: column; break-after: page; }
.cover-band { flex: 0 0 196mm; background: linear-gradient(160deg, #3a3e72 0%, var(--navy) 45%, var(--navy-2) 100%); color: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 20mm; }
.cover-logo { width: 58mm; height: 58mm; border-radius: 50%; background: #fff; box-shadow: 0 2mm 8mm rgba(0,0,0,.35); margin-bottom: 11mm; }
.cover-kicker { font-size: 15pt; letter-spacing: .5mm; opacity: .85; }
.cover-title { font-size: 30pt; font-weight: 700; line-height: 1.3; margin-top: 2mm; }
.cover-version { margin-top: 6mm; font-size: 11pt; padding: 1.5mm 5mm; border: 0.3mm solid rgba(255,255,255,.45); border-radius: 20mm; }
.cover-version strong { font-weight: 500; }
.cover-body { flex: 1; padding: 16mm 24mm 0; text-align: center; color: var(--muted); font-size: 11.5pt; }
.cover-body p:first-child { color: var(--ink); font-size: 13pt; }
.cover-note { margin: 12mm auto 0; max-width: 150mm; font-size: 9pt; line-height: 1.6; text-align: left; padding: 3mm 4mm; border-left: 1.2mm solid #8a90b3; background: #f2f3f8; border-radius: 1.5mm; }

/* table of contents */
.toc { margin-bottom: 12mm; }
/* the first section follows the contents on the same page, kept in one piece */
main > .keep { display: inline-block; width: 100%; padding-top: 3mm; } /* monolithic: moves to the next page as a whole; the padding keeps Thai marks above the first line on its page */
main > .keep > h2 { break-before: auto; }
.toc-title { font-size: 20pt; font-weight: 700; color: var(--navy); margin: 0 0 5mm; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc a { display: flex; align-items: baseline; gap: 2mm; }
.toc i { flex: 1; border-bottom: 0.3mm dotted #b9bccb; transform: translateY(-1.2mm); }
.toc b { font-weight: 500; min-width: 7mm; text-align: right; }
.toc-ch { font-weight: 600; font-size: 10.3pt; margin-top: 2mm; color: var(--navy); break-after: avoid; }
.toc-sec { font-size: 9.2pt; padding-left: 7mm; line-height: 1.45; color: var(--ink); }

/* body. Headings get a little top padding: Thai marks stacked above the first line would otherwise be painted
   at the bottom of the previous page when the heading starts a page. */
h2 { break-before: page; break-after: avoid; font-size: 19pt; line-height: 1.35; color: var(--navy); margin: 0 0 5mm; padding: 2mm 0 2.5mm; border-bottom: 0.6mm solid var(--navy); }
h3 { font-size: 13.5pt; line-height: 1.4; color: var(--navy); margin: 5.5mm 0 2.5mm; padding-top: 1.5mm; break-after: avoid; }
h4 { font-size: 11pt; line-height: 1.45; color: var(--navy); margin: 3.5mm 0 1.2mm; padding-top: 1mm; break-after: avoid; }
p.lead { margin: 3.5mm 0 1.5mm; break-after: avoid; color: var(--navy); }
h2 + h3 { margin-top: 0; }
ul, ol { margin: 0 0 3mm; padding-left: 6.5mm; }
li { margin: 0.6mm 0; }
li > ul, li > ol { margin: 0.6mm 0 0; }
ol > li::marker { font-weight: 600; color: var(--navy); }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 4.5mm; font-size: 9.4pt; line-height: 1.55; }
th { background: var(--navy); color: #fff; font-weight: 600; text-align: left; }
th, td { border: 0.25mm solid var(--line); padding: 1.4mm 2.2mm; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f7f8fb; }
tr { break-inside: avoid; }
figure { margin: 3mm 0 5.5mm; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; border: 0.25mm solid var(--line); border-radius: 1.5mm; box-shadow: 0 0.6mm 2mm rgba(20,24,60,.10); }
figcaption { margin-top: 1.8mm; font-size: 8.8pt; color: var(--muted); }
.callout { margin: 2mm 0 4.5mm; padding: 2.6mm 4mm; border-left: 1.4mm solid #8a90b3; background: #f2f3f8; border-radius: 1.5mm; break-inside: avoid; }
.callout p { margin: 0; }
.callout.tip { border-color: #2f8f5b; background: #edf7f1; }
.callout.warn { border-color: #d98a1c; background: #fdf4e6; }
`;

// ---------------------------------------------------------------------------------------------------- PDF reading

/** Objects of a PDF as Chromium (Skia) writes it (plain objects, classic xref): number -> { dict, start }. */
function pdfObjects(buf) {
  const text = buf.toString("latin1");
  const objs = new Map();
  const re = /(\d+) 0 obj\b/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endobj", start);
    const body = text.slice(start, end);
    const stream = body.indexOf("stream");
    // Only the dictionary part: stream data is binary and must never be searched or patched.
    objs.set(Number(m[1]), { dict: stream >= 0 ? body.slice(0, stream) : body, start });
    re.lastIndex = end;
  }
  return objs;
}

function pageCount(buf) {
  return pageOrder(pdfObjects(buf)).length;
}

const refOf = (dict, key) => {
  const m = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(dict ?? "");
  return m ? Number(m[1]) : null;
};

/** Pages in document order (object numbers), from the page tree. */
function pageOrder(objs) {
  const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.dict));
  const order = [];
  const walk = (n) => {
    const d = objs.get(n).dict;
    if (/\/Type\s*\/Page\b/.test(d)) return order.push(n);
    for (const k of /\/Kids\s*\[([^\]]*)\]/.exec(d)[1].matchAll(/(\d+) 0 R/g)) walk(Number(k[1]));
  };
  walk(refOf(catalog.dict, "Pages"));
  return order;
}

function decodePdfString(raw) {
  if (raw.startsWith("<")) {
    const bytes = Buffer.from(raw.slice(1, -1).replace(/\s+/g, ""), "hex");
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
    return bytes.toString("latin1");
  }
  return raw.slice(1, -1);
}

const TITLE_RE = /\/Title\s*(<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\))/;
const DEST_RE = /\/(Dest|D)\s*\[\s*(\d+) 0 R\s*\/XYZ\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g;
/**
 * Chromium bug: a heading that starts a page gets its PDF destination at the bottom edge of the previous page (and
 * its outline title repeated). A destination this close to the bottom (PDF y grows upwards) means the next page.
 */
const BOTTOM_EDGE = 80;

/** Outline items in document order: { num, title, page (1-based, corrected), titleMatch }. */
function outlineItems(objs) {
  const order = pageOrder(objs);
  const index = new Map(order.map((n, i) => [n, i]));
  const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.dict));
  const outlines = refOf(catalog.dict, "Outlines");
  if (outlines === null) throw new Error("the PDF has no outline (headings)");
  const items = [];
  const walk = (n) => {
    for (let cur = n; cur !== null; cur = refOf(objs.get(cur).dict, "Next")) {
      const d = objs.get(cur).dict;
      const title = TITLE_RE.exec(d);
      const dest = [...d.matchAll(DEST_RE)][0];
      let page = dest ? index.get(Number(dest[2])) : undefined;
      if (dest && Number(dest[4]) < BOTTOM_EDGE && page + 1 < order.length) page += 1;
      items.push({ num: cur, title: title ? decodePdfString(title[1]) : "", titleMatch: title, page: page === undefined ? undefined : page + 1 });
      const first = refOf(d, "First");
      if (first !== null) walk(first);
    }
  };
  walk(refOf(objs.get(outlines).dict, "First"));
  return items;
}

/** Page number (1-based) of every heading; the PDF outline lists all headings in document order. */
function headingPages(buf, toc) {
  const items = outlineItems(pdfObjects(buf));
  if (items.length !== toc.length) throw new Error(`PDF outline has ${items.length} headings, expected ${toc.length}`);
  const norm = (s) => s.replace(/\s+/g, "");
  const result = new Map();
  toc.forEach((t, i) => {
    if (!norm(items[i].title).startsWith(norm(t.text)) || !items[i].page) throw new Error(`PDF outline does not match heading "${t.text}"`);
    result.set(t.id, items[i].page);
  });
  return result;
}

/**
 * Repairs what the Chromium bug above breaks, in place and without moving any byte (so the xref stays valid):
 * destinations on a page's bottom edge (outline items and the table-of-contents links) move to the top of the next
 * page, and outline titles get the heading text once. Shorter replacements are padded with spaces, which PDF
 * ignores inside arrays and hex strings.
 */
function patchPdf(buf, toc) {
  const out = Buffer.from(buf);
  const objs = pdfObjects(buf);
  const order = pageOrder(objs);
  const index = new Map(order.map((n, i) => [n, i]));
  const write = (pos, oldText, newText) => {
    if (newText.length > oldText.length) return false;
    const close = newText.slice(-1);
    out.write(newText.slice(0, -1) + " ".repeat(oldText.length - newText.length) + close, pos, "latin1");
    return true;
  };
  let moved = 0;
  for (const [, o] of objs) {
    for (const m of o.dict.matchAll(DEST_RE)) {
      const i = index.get(Number(m[2]));
      if (i === undefined || Number(m[4]) >= BOTTOM_EDGE || i + 1 >= order.length) continue;
      const next = order[i + 1];
      const box = /\/MediaBox\s*\[\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s*\]/.exec(objs.get(next).dict);
      const top = box ? Math.floor(Number(box[1])) : 841;
      if (write(o.start + m.index, m[0], `/${m[1]} [${next} 0 R /XYZ 0 ${top} 0]`)) moved++;
      else throw new Error(`cannot move PDF destination ${m[0]}`);
    }
  }
  const items = outlineItems(objs);
  let titled = 0;
  items.forEach((it, i) => {
    const text = toc[i]?.text;
    if (!text || !it.titleMatch || it.title === text) return;
    const hex = `<FEFF${Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase()}>`;
    const o = objs.get(it.num);
    if (write(o.start + it.titleMatch.index + it.titleMatch[0].indexOf(it.titleMatch[1]), it.titleMatch[1], hex)) titled++;
  });
  return { pdf: out, moved, titled };
}

// ---------------------------------------------------------------------------------------------------- Electron side

async function renderInElectron() {
  const { app, BrowserWindow, nativeImage } = await import("electron");
  const jobFile = process.argv[process.argv.indexOf(RENDER_FLAG) + 1];
  const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
  // Own profile folder: never share the app's userData (it may be running at the same time).
  app.setPath("userData", path.join(path.dirname(jobFile), "electron-profile"));
  app.dock?.hide();
  await app.whenReady();
  try {
    for (const img of job.images) {
      const image = nativeImage.createFromPath(img.src);
      if (image.isEmpty()) throw new Error(`cannot read ${img.src}`);
      fs.writeFileSync(img.out, image.toJPEG(85));
    }
    const win = new BrowserWindow({ show: false, width: 1000, height: 1400 });
    await win.loadFile(job.html);
    await win.webContents.executeJavaScript(
      `Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))]).then(() => 0)`,
    );
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      generateDocumentOutline: true,
      generateTaggedPDF: true,
    });
    fs.writeFileSync(job.pdf, pdf);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
}

// Runs last: every const above (CSS, ...) is initialised by now. In Electron the module must finish loading before
// the app becomes ready, so the render is not awaited here.
if (process.versions.electron) void renderInElectron();
else await main();
