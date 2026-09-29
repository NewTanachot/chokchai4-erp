# Chokchai 4 Yangyont 2002 ERP — โปรแกรมจัดการร้าน โชคชัย 4 ยางยนต์ (ยาง · ช่วงล่าง · แบตเตอรี่)

Offline desktop app (bills, stock, customers, reports, plus users/permissions, change history, employees, time clock
and payroll): Electron 44 + Next.js 16 static export + TypeScript with a local SQLite database. Version 0.1.0 is the
first release (the program name lives in `APP_NAME`, shared/app.ts; keep package.json / electron-builder.yml in sync).
Users are Thai shop staff: every user-facing string is written in **Thai** inside `tr()` and has an English
translation (Thai / English toggle, see "Languages"); code/comments are English.

## Architecture

```
Renderer (Next.js static export, React 19, Tailwind 4, shadcn/ui)
  src/lib/api.ts  ── typed proxy: api.products.list(q)  ─┐
                                                         │ window.erp.invoke("products.list", q)   (electron/preload.ts)
Main process (electron/)                                 ▼
  electron/ipc.ts  ── one channel "erp:invoke" → handler lookup → {ok,data}|{ok:false,error}
  electron/api/access.ts       ── ACCESS rules (login / permission per method), wrapped around the API by withAccessControl
  electron/api/<namespace>.ts  ── business logic (validates input with zod, Drizzle ORM)
  electron/db/schema.ts        ── SQLite schema (better-sqlite3 13, WAL)
shared/  ── imported by both sides (no Node/Electron imports allowed here)
  shared/contract/*.ts  ── THE API: TypeScript interfaces + zod input schemas per namespace
  shared/calc.ts        ── bill math (line totals, discount, VAT) used by UI preview AND main process
  shared/money.ts       ── satang helpers / formatting
  shared/dates.ts       ── "YYYY-MM-DD" date-only helpers;  shared/payroll.ts ── pure attendance / pay math
  shared/i18n/          ── translate() + en.json (Thai -> English dictionary)
```

`ErpApi` (shared/contract/index.ts) is transport-agnostic so a later phase can serve the same interface over HTTP
from a web backend (see docs/ARCHITECTURE.md).

## Commands

- `npm run dev` — Next dev server (port 3123) + Electron with auto-restart of main process. On macOS the launchers run a copy of
  Electron.app named after the product (menu bar / Dock name; scripts/electron-env.mjs `electronBinary`).
- `npm run build` — static export to `out/` + bundle main/preload to `dist-electron/`. `npm start` runs that build.
- `npm test` — vitest (tests/**/*.test.ts), in-memory SQLite via `tests/helpers/db.ts#createTestApi()`.
- `npm run typecheck` — `tsc --noEmit` (TypeScript 7).
- `npm run db:generate` — after changing electron/db/schema.ts, generates a SQL migration in drizzle/.
- `npm run dist:mac` / `npm run dist:win` — installers into dist/ (Windows can be built on macOS).
- `npm run logo [-- path/to/logo.png]` — regenerates the icons from the logo (default build/logo-source.*):
  build/icon.png (macOS: badge on a navy rounded-square tile with Apple's icon-grid margins), build/icon-win.png
  (Windows) and public/logo.png (round badge used in the app).
- `node scripts/i18n.mjs check|missing|add <file>|prune` — the English dictionary (see "Languages").
- `node scripts/build-manual.mjs` — rebuilds docs/manual/USER_MANUAL.pdf (the Thai user manual) from USER_MANUAL.md
  and docs/manual/images/ (Electron prints A4 with the app's Thai font). Update the manual and its screenshots when
  a screen changes.
- Screenshots (for checking UI without clicking around):
  `node scripts/screenshot.mjs --dev <port> --demo --routes "/products/,/customers/" --themes light,dark --out <dir>`
  starts its own `next dev` on `<port>` (isolated `.next-<port>` dir — safe to run several in parallel with different
  ports), seeds demo data (`--demo`, electron/dev/demo-seed.ts) into a temp DB, saves `<route>.<theme>.png` and
  `console-errors.txt` into `<dir>`. For dialogs/interactions use `--routes-file shots.json` with
  `[{"route":"/products/","js":"document.querySelector('[data-shot=new-product]')?.click()","name":"product-new"}]`.
  View PNGs with the Read tool. The app has a login: with `--demo` shots start logged in as the demo owner
  "เจ้าของร้าน" (`--login "น้องเมย์"` = a staff user, `--login none` = the login screen; demo passwords: owner 1234,
  พี่ต้น 2222, น้องเมย์ 1111, ช่างเอก has no password). `--lang en` = English. Clicking in-app links from `js` is
  fine; `location.assign()` hangs the run. NOTE: the Electron binary must be launched without `ELECTRON_RUN_AS_NODE`
  (scripts/electron-env.mjs handles this).

## Data conventions (important)

- **Money = integer satang** everywhere (DB, API, state). 1 บาท = 100. Convert only at the UI edge
  (`MoneyInput` takes/returns satang; `formatBaht(satang)` for display).
- Quantities are numbers with ≤ 2 decimals (`roundQty`).
- qty × money: always `mulQty(qty, amount)` (shared/calc.ts, half up, exact for 2-decimal qty), never
  `Math.round(qty * price)` (0.35 × 1350 → 472 instead of 473). In SQL: `(CAST(ROUND(qty*100) AS INTEGER) * x + 50) / 100`.
- Purchase line cost = `purchaseUnitCost(line, vatMode, vatRate)`: after the line discount, without VAT (the bill discount
  is not allocated). Product cost follows the latest purchase's `unit_cost`.
- Bills: `occurred_at` = bill date (sales/expense figures), `paid_at` = when the money changed hands (cash-flow figures,
  e.g. "รับเงินวันนี้"); set only by `paidAtFor()` in electron/api/transactions.ts. Never count unpaid bills as money received.
- IDs: UUIDv7 strings from `newId()` (electron/api/util.ts). Timestamps: epoch ms (`Date.now()`).
- Top-level tables have `created_at/updated_at/deleted_at`; **always filter `deletedAt IS NULL`** and soft-delete
  (set `deletedAt`, `updatedAt`). Child rows (`transaction_items`, `stock_movements`) are replaced wholesale.
- Stock: `products.stock_qty` is a cache of `SUM(stock_movements.qty)`. Never set it directly — insert/delete
  movements then call `recomputeStock(tx, productId)` (electron/api/stock.ts) in the same DB transaction.
- Date ranges in the API are `[from, to)` epoch ms computed in **local time** by the caller (`dayRange()`,
  `monthRange()` in src/lib/format.ts). Group-by-day in SQL must use local time
  (`date(occurred_at/1000, 'unixepoch', 'localtime')`).
- Settings: read server-side with `readSettings(db)` (electron/api/settings.ts); defaults in shared/contract/settings.ts.
- Date-only values (attendance day, leave, pay period, birthday, start date) are `"YYYY-MM-DD"` strings in local time
  (`toDateStr`, `addDays`, `eachDate`… in shared/dates.ts), never epoch ms. Clock-in/out times are epoch ms.
- Migrations start at drizzle/0000_init (0.1.0). A database of the pre-release test builds (older migrations only,
  `checkSchemaVersion().legacy`) is not opened: startup replaces it with a new one, restore rejects it, and the old
  "Chokchai4 ERP" data folder is deleted at startup (electron/legacy.ts).
- Payroll math lives only in shared/payroll.ts (`attendanceStats`, `proratedSalary`, `socialSecurityOf`, …): pure
  functions used by the payroll API and the UI, tested in tests/payroll-calc.test.ts.

## Users, permissions and history (who did what)

- The session lives in the main process (`ctx.session.userId`, electron/api/session.ts); the renderer cannot forge it.
  A user may have no password (`users.password_hash` null, `hasPassword: false`): they log in by tapping their name.
  Roles: `owner` (everything) and `staff` (only the permissions the owner ticked: `PERMISSIONS` / `PERMISSION_INFO`
  in shared/contract/auth.ts; a new permission needs a Thai label + hint there and then shows up in the user form).
- **Every API method needs exactly one rule in `ACCESS`** (electron/api/access.ts): `"public" | "user" | "owner" |
  permission | [all of] | {anyOf}` or a function of the input. The table is typed over `ErpHandlers`, so a new method
  does not compile without a rule. Rules are enforced at the IPC boundary (`withAccessControl` → `UNAUTHORIZED` /
  `FORBIDDEN`); handlers stay permission-free, and `createTestApi()` calls them unguarded (use `guardedApi(t)` from
  tests/helpers/auth.ts to test the rules).
- **Every write records history in the same DB transaction**: `writeAudit(tx, actorOf(tx, ctx.session), {...})`
  (electron/api/audit.ts) with `diffFields(before, after, FIELDS)` on update / `initialFields` on create. Product and
  service price changes also go to `recordPriceChange()` (electron/api/price-history.ts). Bills stamp
  `createdBy` / `updatedBy` / `voidedBy`, stock movements `createdBy`. History rows are append-only.
- Renderer: `useAuth()` (src/lib/auth.tsx) gives `user`, `isOwner`, `can(permission)`. Hide buttons, menu items and
  nav entries the user may not use, and wrap whole pages in `<RequirePermission>`. This only hides things; the server
  check is what enforces the rules. The time clock (`/clock/`) works without logging in (tap your own name).

## Main-process conventions

- One file per namespace: `electron/api/<ns>.ts` exporting `create<Ns>Api(ctx: ApiContext): Handlers<<Ns>Api>`.
- **Validate every input** with the zod schema from the contract (`schema.parse(input)`) — IPC input is untrusted.
- Throw `AppError(code, "ข้อความภาษาไทย")` / `notFound("สินค้า")` for user-facing errors. Zod errors and SQLite
  constraint errors are mapped automatically (electron/api/errors.ts).
- better-sqlite3 is **synchronous**: `db.transaction((tx) => { ... })` callbacks must be sync (no `await`), use
  `.run() / .all() / .get()`. Put every multi-row write in a transaction.
- Transactions read model: use `loadTransactionDetails(db, ids)` / `loadTransactionSummaries(db, ids)`
  (electron/api/transaction-read.ts) — queries pick ids (filter/order/page), loaders build the objects.
- Correlated subqueries: write explicit table-qualified raw SQL (`WHERE t.customer_id = customers.id`), NOT
  `${customers.id}` — Drizzle renders unqualified column names in single-table selects, which silently binds to the
  inner table.
- Search: `likePattern(q)` + `ESCAPE '\\'`; phone search compares digits only (`digitsOnly`).
- Return plain JSON-serialisable objects (they cross IPC and, later, HTTP).

## Languages (Thai / English)

- Thai is the source language. Every user-facing string in src/ is `tr("ข้อความ")` / `tr("บันทึกบิล {0} แล้ว", docNo)`
  from "@/lib/i18n". One template per sentence: never glue translated pieces (`tr("ลบ") + name` breaks English word
  order). The English lives in shared/i18n/en.json, keyed by the Thai text; English values may use plurals
  `"{0} {0|bill|bills}"`.
- After adding or changing Thai text: `node scripts/i18n.mjs missing` → translate → `node scripts/i18n.mjs add <file>`
  → `prune`. tests/i18n.test.ts fails on any missing / unused key or mismatched `{n}` parameters.
- Same Thai, different English: `trc("<context>", "ไทย")` with a `"<context>|ไทย"` key. Contexts in use: `nav`
  (menu / page names), `plural`, `unit` (after a count), `role`, `perm`, `copies`, `audit` (history titles).
- The language is per computer (system.setLanguage → meta "language"); changing it reloads the page, so module-level
  `tr()` is fine. `Providers` renders the app only after mount (the static HTML is pre-rendered in Thai).
- Shared label tables (shared/contract, e.g. PAYMENT_METHOD_LABELS) are Thai data used by both processes; the renderer
  translates them in place at startup (list in src/lib/i18n.ts; add new tables there).
- Main process: error messages stay Thai and are translated by the renderer (ApiClientError), including messages
  built from templates ("ใส่รหัสผิดหลายครั้ง กรุณารอ {0} วินาที…" is matched back to its key). Native menus and dialogs
  use `tr()` from electron/i18n.ts (the main process knows the language).
- Data stays as typed (names, notes, categories). Thai the program itself stored (payslip line labels, price-change
  notes, history list values) is shown with `tr()`.
- Dates / numbers: `LOCALE` from "@/lib/i18n" (th-TH = Buddhist-era years, en-GB), calendars `CALENDAR_LOCALE`.
- Printed documents follow the document-language setting (`print.documentLanguage`, default Thai), passed to the
  /print routes as `?lang=`; amounts in words: `amountInWords(satang, lang)` (shared/bahttext.ts).

## Renderer conventions

- Static export: **no dynamic route segments, no server actions, no API routes**. Detail pages use query params
  (`/customers/view/?id=...`); components calling `useSearchParams`/`useSearchParam` must be inside `<Suspense>`.
  Links keep the trailing slash before `?` (`trailingSlash: true`).
- Pages are client components (`"use client"`), data via React Query:
  `useQuery({ queryKey: ["products", "list", q], queryFn: () => api.products.list(q) })`.
  Writes via `useApiMutation(fn, { successMessage: "บันทึกแล้ว" })` (src/lib/query.ts) which invalidates all
  queries and toasts errors.
- Lists with "แสดงเพิ่ม": grow `limit` and fetch with `fetchFirst(limit, (limit, offset) => api.x.list({...q, limit, offset}))`
  (src/lib/paging.ts) — one request may ask for at most `MAX_PAGE_LIMIT` (1000) rows.
- UI kit: shadcn/ui (radix-nova style) in src/components/ui — use, don't modify. Icons: lucide-react.
  Charts: shadcn `chart` (recharts) in src/components/ui/chart.tsx.
- Shared app components: `PageHeader`, `MoneyInput`, `QtyInput`, `ConfirmDialog` (src/components/),
  formatters in src/lib/format.ts (`formatBaht`, `formatDate`, `formatDateTime`, `formatRelative`, ranges).
- Theme tokens (light/dark aware): `bg-background`, `bg-card`, `text-muted-foreground`, `text-primary`,
  `text-income` (รายรับ, green), `text-expense` (รายจ่าย, red), `bg-success`, `bg-warning`, `text-destructive`.
  Never hard-code colors like `text-green-600`; add `className="num"` to numeric cells/totals (tabular figures).
- UX rules: Thai labels (in `tr()`); big comfortable targets; Enter submits forms, Esc closes dialogs; autofocus the first
  field; loading skeletons; empty states with a clear call-to-action; confirm destructive actions; success toast
  after saves; show money right-aligned with ฿; keep screens usable at 1024×680 (the min window size).
- Mark buttons that screenshots may need to click with `data-shot="..."`.
- Tables must fit at 1024×680 with the sidebar open: put secondary details (bank account, creator) on their own
  small line instead of widening a column, and keep badges short.
- The macOS title bar is hidden: the top header is a drag region (`app-drag`); interactive elements inside it
  are automatically non-draggable.
