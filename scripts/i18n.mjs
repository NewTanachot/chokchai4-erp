// Thai -> English dictionary (shared/i18n/en.json) maintenance.
//   node scripts/i18n.mjs check          missing / unused keys and placeholder mismatches (exit 1 when something is missing)
//   node scripts/i18n.mjs missing        JSON array of Thai strings that have no English yet
//   node scripts/i18n.mjs add file.json  merges {"<thai>": "<english>"} into en.json
//   node scripts/i18n.mjs prune          removes keys no code uses any more
//
// Keys come from: tr("…") / translate(lang, "…") calls in src/; every Thai string / template in shared/ (labels,
// validation messages) and electron/ (error messages that the renderer translates), plus the messages built by
// notFound("…") and reqText("…"). Seed / demo data is not translated. Parser: Next's bundled Babel parser.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
/** Thai letters (not the Baht sign ฿, which also sits in the Thai block). */
const TH = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;
/** Thai data, not UI text. */
const IGNORE = new Set(["โชคชัย 4 ยางยนต์ 2002"]);
/** SQL that mentions Thai characters (sorting rules). */
const IGNORE_RE = /\bCASE WHEN\b|\bsubstr\(/;
const SKIP_FILES = [
  "src/components/ui/",
  "shared/i18n/",
  "electron/dev/",
  "electron/db/seed.ts",
  // Thai words for amounts (the English document wording lives next to it).
  "shared/bahttext.ts",
];

function files(root, dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(root, p).split(path.sep).join("/");
      if (SKIP_FILES.some((s) => rel.startsWith(s))) continue;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
    }
  };
  walk(path.join(root, dir));
  return out;
}

const isNode = (v) => v && typeof v === "object" && typeof v.type === "string";
function eachNode(node, parent, f) {
  f(node, parent);
  for (const k of Object.keys(node)) {
    if (k === "loc" || k === "extra" || k.endsWith("Comments")) continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => isNode(c) && eachNode(c, node, f));
    else if (isNode(v)) eachNode(v, node, f);
  }
}

/** "a${x}b${y}" -> "a{0}b{1}" */
const templateKey = (node) =>
  node.quasis.map((q, i) => (q.value.cooked ?? q.value.raw) + (i < node.expressions.length ? `{${i}}` : "")).join("");

const literal = (node) =>
  node?.type === "StringLiteral" ? node.value : node?.type === "TemplateLiteral" && node.expressions.length === 0 ? templateKey(node) : null;

/** Every translatable Thai string: Map<key, "file:line"[]>. */
export function collectKeys(root) {
  const { parse } = require("next/dist/compiled/babel/parser");
  const keys = new Map();
  const add = (key, file, node) => {
    if (!key || !TH.test(key) || IGNORE.has(key) || IGNORE_RE.test(key)) return;
    const at = `${path.relative(root, file)}:${node.loc?.start.line ?? 0}`;
    if (!keys.has(key)) keys.set(key, []);
    keys.get(key).push(at);
  };
  for (const dir of ["src", "shared", "electron"]) {
    for (const file of files(root, dir)) {
      const code = fs.readFileSync(file, "utf8");
      const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
      const everything = dir !== "src";
      eachNode(ast.program, null, (node, parent) => {
        if (node.type === "CallExpression") {
          const callee = node.callee.type === "Identifier" ? node.callee.name : null;
          if (callee === "tr") add(literal(node.arguments[0]), file, node);
          if (callee === "trc" && literal(node.arguments[0]) && literal(node.arguments[1])) {
            add(`${literal(node.arguments[0])}|${literal(node.arguments[1])}`, file, node);
          }
          if (callee === "translate") add(literal(node.arguments[1]), file, node);
          const arg = literal(node.arguments[0]);
          if (callee === "notFound" && arg) add(`ไม่พบ${arg}`, file, node);
          if (callee === "reqText" && arg) {
            add(`กรุณากรอก${arg}`, file, node);
            add(`${arg}ยาวเกินไป`, file, node);
          }
          return;
        }
        if (!everything) return;
        if (parent?.type === "CallExpression" && parent.callee.type === "MemberExpression" && parent.callee.object.name === "console") return;
        if (node.type === "StringLiteral") {
          const isKey = (parent?.type === "ObjectProperty" || parent?.type === "TSPropertySignature") && parent.key === node;
          if (!isKey && parent?.type !== "ImportDeclaration" && parent?.type !== "TSLiteralType") add(node.value, file, node);
        } else if (node.type === "TemplateLiteral" && parent?.type !== "TaggedTemplateExpression") {
          add(templateKey(node), file, node);
        }
      });
    }
  }
  return keys;
}

const dictPath = (root) => path.join(root, "shared", "i18n", "en.json");
export const loadDictionary = (root) => JSON.parse(fs.readFileSync(dictPath(root), "utf8"));

function saveDictionary(root, dict) {
  const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.writeFileSync(dictPath(root), JSON.stringify(sorted, null, 2) + "\n");
}

const indices = (s) => new Set([...s.matchAll(/\{(\d+)(?:\|[^{}]*)?\}/g)].map((m) => m[1]));

/** What is missing / unused / inconsistent. */
export function analyze(root) {
  const keys = collectKeys(root);
  const dict = loadDictionary(root);
  const missing = [...keys.keys()].filter((k) => !(k in dict)).sort();
  const unused = Object.keys(dict).filter((k) => !keys.has(k)).sort();
  const placeholderMismatch = Object.entries(dict)
    .filter(([k, v]) => {
      const a = indices(k);
      const b = indices(v);
      return a.size !== b.size || [...a].some((i) => !b.has(i));
    })
    .map(([k]) => k);
  // Thai left in an English value (a Thai example such as a licence plate is fine next to English words).
  const untranslated = Object.entries(dict)
    .filter(([k, v]) => !v.trim() || v === k || (TH.test(v) && !/[A-Za-z]/.test(v)))
    .map(([k]) => k);
  return { keys, missing, unused, placeholderMismatch, untranslated };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "missing") {
    console.log(JSON.stringify(analyze(root).missing, null, 1));
  } else if (cmd === "add") {
    const add = JSON.parse(fs.readFileSync(path.resolve(arg), "utf8"));
    const dict = { ...loadDictionary(root), ...add };
    saveDictionary(root, dict);
    console.log(`added ${Object.keys(add).length}; ${Object.keys(dict).length} keys`);
  } else if (cmd === "prune") {
    const r = analyze(root);
    const dict = loadDictionary(root);
    for (const k of r.unused) delete dict[k];
    saveDictionary(root, dict);
    console.log(`removed ${r.unused.length} unused keys`);
  } else {
    const r = analyze(root);
    console.log(`${r.keys.size} keys in code, ${r.missing.length} missing, ${r.unused.length} unused, ${r.placeholderMismatch.length} placeholder mismatches, ${r.untranslated.length} untranslated`);
    for (const k of r.missing.slice(0, 40)) console.log(`  missing: ${k}  (${r.keys.get(k)[0]})`);
    for (const k of r.placeholderMismatch) console.log(`  placeholders differ: ${k}`);
    for (const k of r.untranslated) console.log(`  untranslated: ${k}`);
    process.exit(r.missing.length || r.placeholderMismatch.length || r.untranslated.length ? 1 : 0);
  }
}
