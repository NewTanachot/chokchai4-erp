# HANDOFF: Chokchai4 ERP (read this first if you are continuing this project)

This file records everything learned in the first build sessions (2026-09-25), the users / history / payroll
session (2026-09-26, §9) and the first-release / Thai-English session (§10), so another AI or developer can pick up
where it stopped. Read it together with `CLAUDE.md`, which holds the coding conventions every
contributor must follow. Repo: `/Users/lmwn/tanachot/repo/chokchai4-erp`, macOS arm64, Node 24.6, npm 11.5.

---

## 1. What the user asked for (original request, verbatim Thai)

> อยากได้โปรแกรม สำหรับธุรกิจ อู่ซ่อมรถ ขายยาง ขายแบตเตอรี่รถยนต์ โดย อยากได้ electron app ที่เขียนด้วย
> - electron version ล่าสุด — build ออกมาให้เป็นโปรแกรมที่ใช้ได้ทั้ง MAC / Window
> - next.js version ล่าสุด
> - ใช้ภาษา typescript
> - database ใช้ให้มันอยู่เป็น offline บนเครื่องที่ลงโปรแกรมนี้ไปก่อน แต่คิดถึง phase ต่อไปที่จะย้าย DB นี้ให้มันดึง data จาก web app ได้ด้วย — ใช้ SQLite ดีไหม หรือมีอย่างอื่นที่ดีกว่า
> - ทำ UX/UI ให้ใช้งานง่าย สบายตา มี light/dark theme
> - รูปที่แนบให้ไปคือ app logo
>
> Requirement phase แรก
> - เก็บข้อมูล stock สินค้า พร้อมราคาซื้อ / ราคาขาย
> - เก็บข้อมูลรายการ service พร้อมราคาตั้งต้น
> - เปิด transaction รายการซื้อ รายการขาย โดยใช้จาก สินค้า และ service โดยที่จะสามารถเปลี่ยนราคาได้ตอน create รายการ
>   - รายการซื้อ ก็จะหักเป็นต้นทุนสินค้า และ เพิ่ม stock
>   - รายการขาย ก็จะหักเป็นรายได้ และ ลด stock
>   - แก้ไข transaction ได้
> - เปิด invoice / receipt สำหรับ transaction นั้นได้ (print ออกมาเป็นกระดาษใบเสร็จ)
> - ระบบเก็บข้อมูลลูกค้า (ชื่อ, เบอร์โทร, lineID, email, ชื่อร้านค้า)
> - phase แรก ต้องสามารถ query ออกไปได้ประมาณนี้
>   - วันนี้มี transaction อะไรบ้าง (รายรับ รายจ่าย เท่าไหร)
>   - ลูกค้าคนนี้เคยมาใช้บริการหรือยัง มี transaction ไหม ถ้ามีทำอะไรไป ทำไปเมื่อไหรบ้าง

Later messages from the user:
- They sent the logo inline in chat: a round brushed-silver badge with a navy (#2b2e55) border. Text: "โชคชัย 4 ยางยนต์",
  "— 2002 —", a sedan silhouette, icons for tyre, shock absorber and battery, and "ยาง ช่วงล่าง แบตเตอรี่" along
  the bottom. **The image was never saved to disk**, so a similar-looking placeholder was generated (see §6).
- "ทำต่อไปเรื่อยๆ ถ้ารู้ตัวว่าจะติด rate limit แล้ว ให้สร้างเป็น File MD ใส่ความรู้และทุกสิ่งทุกอย่าง… จะเอาไปให้ AI
  อีกตัว run ต่อ": keep going, and write this handoff file for another AI.
- The user replies in Thai. Answer them in Thai.

Shop identity (from the logo): **โชคชัย 4 ยางยนต์**, est. 2002, business lines ยาง · ช่วงล่าง · แบตเตอรี่ (tyres, suspension,
batteries), plus general car-repair services.

---

## 2. Key decisions and why

| Topic | Decision | Why |
|---|---|---|
| Versions (latest on 2026-09-25) | Electron **44.4.5** (Node 24.21, Chromium 152), Next **16.3.6** (Turbopack), React **19.3**, TypeScript **7.0.2**, Tailwind **4.3**, shadcn CLI **4.21** (radix-nova style), Drizzle ORM **0.45.3** / drizzle-kit **0.31.11**, better-sqlite3 **13.0.3**, zod **4.6**, electron-builder **26.15**, vitest **5.0** | The user asked for the latest versions |
| Database | **SQLite through better-sqlite3 13 + Drizzle ORM** | Battle-tested embedded DB. better-sqlite3 v13 uses N-API and **ships prebuilt binaries for darwin/win32/linux inside the npm package** (`node_modules/better-sqlite3/prebuilds/*.node`), so there is no electron-rebuild and **the Windows build can be made on a Mac**. Verified: it loads in Electron 44 without a rebuild. `node:sqlite` also works in Electron 44 (SQLite 3.53.4), but Drizzle support for it is still beta. |
| Alternatives considered | libSQL/Turso (embedded replicas sync to a cloud DB, a possible phase-2 path), PGlite (Postgres in WASM, same dialect as a future Postgres backend, but less mature), sql.js (in-memory, weak durability) | Rejected for phase 1 |
| Future web sync readiness | UUIDv7 text ids, integer-ms timestamps, `created_at/updated_at/deleted_at` soft deletes, money as integer satang, a transport-agnostic `ErpApi` contract in `shared/contract` | The renderer never touches the DB. Phase 2 can swap `src/lib/api.ts` (IPC) for an HTTP client, or add a sync engine in the main process |
| Next.js + Electron integration | Next **static export** (`output: "export"`, `trailingSlash: true`) served by a custom privileged protocol `app://erp/` (electron/protocol.ts). Dev mode loads `http://localhost:3123`. All data goes over one IPC channel `erp:invoke` | No Node server inside the app, simple packaging, secure (contextIsolation + sandboxed preload + CSP) |
| Routing | No dynamic segments. Detail pages use `?id=`, e.g. `/customers/view/?id=…`, and must wrap `useSearchParams` in `<Suspense>` | A requirement of static export |
| Money | Integer **satang** everywhere. `shared/calc.ts` `computeTotals()` is the single source of truth for bill math (line totals, bill discount, VAT none/inclusive/exclusive) and is used by both the UI preview and the main process | No float drift |
| Stock | Ledger table `stock_movements`. `products.stock_qty` is a cache recomputed by `recomputeStock()`. Editing a bill deletes and re-creates its movements; voiding a bill deletes them | Edits stay correct and there is an audit trail |
| Document numbers | `S6909-0001` = prefix + Buddhist-era YY + MM + running number per month, stored in the `doc_sequences` table. Prefixes are set in settings | Thai shops use the Buddhist-era (พ.ศ.) year |
| Printing | A hidden BrowserWindow renders `/print/?id=&kind=&paper=` and then calls `webContents.print` / `printToPDF`. Thermal paper 80 mm / 58 mm uses a measured page height; A4/A5 also supported | Works with thermal receipt printers |
| UI | Tailwind 4 + shadcn/ui (Radix), IBM Plex Sans Thai (bundled offline through @fontsource), next-themes (light/dark/system), React Query for data, sonner for toasts | Clean, legible Thai UI |
| Brand theme | Navy + silver taken from the logo (tokens in `src/app/globals.css`). In light mode the sidebar is navy. Semantic tokens `income`/`expense`/`success`/`warning` | Matches the logo |
| Extra fields added (not requested, useful for a garage) | Vehicle plate / model / mileage on bills; customer taxId/address; payment method and paid/unpaid status; VAT settings; auto-backup | Customer search also matches licence plates |

---

## 3. Environment gotchas (these cost time; don't repeat them)

1. **`ELECTRON_RUN_AS_NODE=1` is set in this Claude Code environment** (the host is VS Code). With it set, Electron runs as
   plain Node and `app` is undefined. Every launcher script deletes it (`scripts/electron-env.mjs`). When you launch
   manually, use `env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .`.
2. **npm optional-dependency bug**: after some `npm i`/`uninstall` runs, `@rolldown/binding-darwin-arm64` disappears and
   vitest fails with "Cannot find native binding". The fix is `rm -rf node_modules package-lock.json && npm i`. Never add the
   platform binding to package.json (that breaks Windows installs).
3. **TypeScript 7** (Go-native) has **no JS compiler API** (`require('typescript').createProgram` is undefined), but
   Next 16.3.6 builds with it fine. Use `npx tsc --noEmit -p tsconfig.json` (fast, about 1 s).
4. **shadcn 4.21** components import `cn` from the npm package **`cn`** (official, by shadcn). It is installed as a devDependency.
   shadcn's CLI also puts packages into `dependencies`. Move them to devDependencies, because only `better-sqlite3`
   may be a runtime dependency (electron-builder packages `dependencies`). Everything the renderer and main need is bundled.
5. **Next rewrites tsconfig.json** when it runs with a custom `distDir`. The preview tooling therefore passes
   `NEXT_TSCONFIG=tsconfig.preview-<port>.json` (next.config `typescript.tsconfigPath`). Don't let it touch the main tsconfig.
6. **Drizzle correlated subqueries**: in single-table selects Drizzle renders `${table.col}` without the table prefix,
   so inside a subquery it silently binds to the inner table. Write raw, qualified SQL instead: `WHERE t.customer_id = customers.id`.
7. Stale `.next/types` breaks tsc after routes move. Fix it with `rm -rf .next`.
8. Bash `timeout` doesn't exist on this Mac.
9. Screenshot mode captures a **hidden** window (`capturePage` works with `show:false`), so no windows pop up.

---

## 4. Architecture and file map

```
package.json            main = dist-electron/main.cjs; the only runtime dependency is better-sqlite3;
                        productName "Chokchai 4 Yangyont 2002 ERP" (= APP_NAME in shared/app.ts), version 0.1.0
next.config.ts          static export, trailingSlash, distDir/tsconfig overridable by env (preview servers)
electron-builder.yml    mac dmg (arm64+x64, ad-hoc signed), win nsis x64 (icon build/icon-win.png); asarUnpack better-sqlite3;
                        npmRebuild false; drizzle/ copied as extraResources; per-OS prebuild filtering
drizzle.config.ts       schema electron/db/schema.ts -> drizzle/ (0000_init.sql generated)
vitest.config.mts       node env, aliases @shared, @
CLAUDE.md               conventions (READ IT)
docs/HANDOFF.md         this file
build/icon.png          1024² macOS icon: the logo badge on a navy rounded-square tile (Apple icon grid); also the dev Dock icon
build/icon-win.png      1024² Windows icon (same tile, small margins)
build/logo-source.jpeg  the shop's logo; `npm run logo` regenerates the three images from it
public/logo.png         512² in-app logo (round badge: sidebar, login, receipt fallback)
scripts/
  build-electron.mjs    esbuild main.ts + preload.ts -> dist-electron/*.cjs (ERP_ELECTRON_OUT overrides outdir; --watch)
  dev-electron.mjs      dev runner: waits for next dev :3123, watch-bundles, restarts Electron
  start-electron.mjs    runs the production build unpackaged
  screenshot.mjs        headless screenshots (see CLAUDE.md); --dev <port> spawns its own next dev + bundle
  set-logo.mjs          `npm run logo [-- <png>]`: trims the white border, crops to a circle, writes the icons above
  electron-env.mjs      env without ELECTRON_RUN_AS_NODE; electronBinary() = the Electron binary; on macOS a clone
                        node_modules/.cache/electron-dev/<productName>.app (folder name = Dock tooltip, Info.plist
                        CFBundleName / CFBundleDisplayName = menu bar) so dev shows the product name
  i18n.mjs              English dictionary tool: check | missing | add <file> | prune (parser: next/dist/compiled/babel)
shared/                 (renderer + main; no Node imports)
  app.ts (APP_NAME) money.ts calc.ts bridge.ts bahttext.ts (Thai + English amounts in words) dates.ts payroll.ts
  i18n/index.ts (translate, plurals, contexts, matching built Thai text) i18n/en.json (Thai -> English)
  contract/common.ts catalog.ts customers.ts transactions.ts reports.ts settings.ts system.ts index.ts (ErpApi)
electron/
  main.ts               bootstrap: userData (ERP_USER_DATA override), open DB, migrate, seedDefaults, IPC, protocol,
                        menu (Thai), screenshot mode, demo seed (ERP_DEMO_SEED=1), runStartupTasks (auto-backup)
  preload.ts            window.erp = { invoke(method, input), platform, isElectron }
  ipc.ts                "erp:invoke" router, trusted-origin check, error mapping
  protocol.ts           app:// scheme serving out/ with CSP and path-traversal guard
  window.ts             main window (mac hiddenInset title bar), hidden renderer windows for printing, getAppUrl()
  menu.ts screenshot.ts i18n.ts (main-process language: menus, dialogs) legacy.ts (deletes the test builds' data)
  db/ schema.ts client.ts (openDatabase: WAL, FK on; types Db/Tx/DbLike) migrate.ts seed.ts (default categories + 10 services at price 0)
  api/ index.ts (createCoreApi) context.ts errors.ts util.ts stock.ts settings.ts transaction-read.ts
       categories.ts products.ts service-items.ts customers.ts transactions.ts reports.ts print.ts system.ts backup.ts
  dev/demo-seed.ts      25 realistic products, 12 customers, ~60 sales + 7 purchases over 30 days (direct inserts, consistent ledger)
src/
  app/layout.tsx (fonts, Providers)   app/(app)/layout.tsx (Sidebar + Header shell)   app/print/ (no shell)
  app/(app)/ page.tsx(dashboard) transactions/{,new,edit,view} products/{,view} services customers/{,view} reports settings
  components/ ui/(shadcn, don't edit) layout/(sidebar, header, nav) providers theme-toggle page-header money-input
              qty-input confirm-dialog coming-soon print/print-dialog.tsx (+ feature folders)
  lib/ api.ts (proxy client) query.ts (useApiMutation invalidates all) format.ts (dates in LOCALE, ranges) utils.ts
       i18n.ts (tr / trc / lang / LOCALE / setLanguage) calendar-locale.ts form-resolver.ts (translated zod messages)
  hooks/ use-search-param.ts
tests/ helpers/db.ts (createTestApi: in-memory DB + migrations + seed), foundation.test.ts, baseline-reads.test.ts, + feature tests
```

Data model tables (one migration, drizzle/0000_init.sql): `categories, products, service_items, customers, transactions,
transaction_items, stock_movements, settings (key/value JSON + meta:* keys: seeded, deviceId, lastAutoBackupAt,
recoveryCodeHash, language, …), doc_sequences`, plus (§9) `users, audit_logs, price_changes, employees, attendance,
leaves, salary_advances, payroll_runs, payslips, payslip_items`.

Data location at runtime: `app.getPath('userData')/chokchai4.db` (macOS:
`~/Library/Application Support/Chokchai 4 Yangyont 2002 ERP/`), with backups in `<userData>/backups/`.

---

## 5. Status: version 0.1.0 (the first release)

Everything in the original request (§1) plus the extensions in §9 and §10 is built and verified. The pre-release
test builds (then called "Chokchai4 ERP", versions 0.1.0 / 0.2.0 of 2026-09-25) were discarded on 2026-09-26 at the
user's request: their installers and data were deleted, the version restarted at **0.1.0**, and the migrations were
squashed into `drizzle/0000_init.sql`. Their session-by-session log lived here; git history has it (commits up to
c15ee2a).

Lessons from those builds that still matter:
- **Packaging:** keep every `files:` pattern at the top level of electron-builder.yml (a platform-level `mac.files` /
  `win.files` makes electron-builder fall back to `**/*` and pack the whole repo). `scripts/after-pack.cjs` drops the
  other OS/arch better-sqlite3 prebuilds. macOS apps are signed ad-hoc (`identity: "-"`, `hardenedRuntime: false`)
  after afterPack; with `identity: null` a downloaded dmg reported the app as "damaged".
- **Money:** `mulQty` for qty × money, `purchaseUnitCost` (net of the line discount, without VAT), `paid_at` vs
  `occurred_at`, `fetchFirst` for lists over 1,000 rows (all in CLAUDE.md, with tests in tests/money.test.ts).
- **IPC router:** only own `namespace.method` keys resolve (tests/ipc.test.ts covers inherited keys, 3-segment names,
  untrusted senders).
- **Unsaved bills:** the bill form registers `beforeunload` while dirty; electron/window.ts asks before closing,
  quitting or reloading. Hidden windows (screenshot runs) never block.
- **Schema versions:** the app refuses a database or backup migrated by a newer version (`SchemaNewerThanAppError`,
  NEWER_BACKUP_MESSAGE); a pre-release database is replaced / rejected (§10).

Verification commands: `npm run typecheck`, `npm test`, `npm run build`, then screenshots
(`node scripts/screenshot.mjs --demo [--lang en] [--login …] --routes-file …`) and PDFs through the
`ERP_PRINT_PDF_DIR` hook (print.savePdf / savePayslipPdf write there without a dialog).

---

## 6. Remaining work (optional / phase 2)

1. **Code signing:** mac builds are signed ad-hoc (no Apple Developer ID), so the first launch needs "Open Anyway";
   Windows needs a code-signing certificate to avoid SmartScreen.
2. **Staff can still see cost prices and profit per unit** (products, purchase bills, stock card). Hiding them needs a
   permission plus server-side stripping of cost fields in the product / transaction / stock reads.
3. The monthly sums on the transactions list are hidden in the UI without `reports.view`, but `transactions.list`
   (rule `user`) still returns them.
4. Social-security defaults (5%, wage base 1,650–17,500 baht; the ceiling announced from 2026) should be confirmed by
   the owner. Thai withholding tax (ภ.ง.ด.1) is not calculated (add it as a manual payslip line).
5. Test on a real thermal printer and a real Windows PC.
6. **Phase 2:** see §7 and `docs/ARCHITECTURE.md` (web backend + sync).

Suggested checks the workflow may not cover: numbers typed with commas in MoneyInput, bills dated in a previous month
(docNo uses the bill's month), time zone (reports use local time), very long product names on the 58 mm receipt, restore of an
older backup (migrations run on the next start).

---

## 7. Phase 2 (web app / sync): design notes for docs/ARCHITECTURE.md

- The UI depends only on `ErpApi` (`shared/contract`). Option A, **online-first**: implement `ErpApi` over HTTP (for example
  a Next.js/Hono server + Postgres with Drizzle, reusing the zod schemas and most of `electron/api/*` logic after a
  dialect port), and ship a web build of the same renderer with `src/lib/api.ts` switched to `fetch`.
- Option B, **offline-first sync** (keeps the desktop working without internet): keep SQLite locally and sync
  aggregates (customers, products, service items, categories, transactions with their items; stock movements are derived and can be
  recomputed) by `updated_at` plus soft deletes, last-write-wins per row. The pieces already in place are UUIDv7 ids, `deviceId` in settings meta,
  and `updated_at` on every aggregate. Add: an outbox/`sync_version` column, server-side conflict rules, and a device prefix
  in document numbers (for example `S1-6909-0001`) so two machines never issue the same number.
- Option C, **managed sync**: libSQL/Turso embedded replicas, or PowerSync/ElectricSQL with Postgres. This means less custom code but vendor lock-in.
- Recommendation: B (or C) if the shop needs the counter PC to keep working when the internet is down. That is typical in Thailand, so it is the likely choice.

---

## 8. Answer for the user's DB question (to include in the final Thai summary)

SQLite fits this job best: it is fast, stable, needs no separate server, and is a single file that is easy to back up.
The project uses better-sqlite3 v13 together with Drizzle ORM. The Drizzle schema is ported to Postgres fairly easily
when phase 2 comes. Everything is designed with sync in mind: UUIDv7 ids, soft deletes, updated_at, and an API layer
separate from the UI. Alternatives worth knowing: libSQL/Turso (sync to cloud with little code), PGlite (Postgres
dialect, but less mature), and PowerSync/ElectricSQL (sync services on top of Postgres).

---

## 9. Session 5 (2026-09-26): users, permissions, change history, employees, time clock, payroll

### Request (verbatim Thai)

> - อยากให้ทำระบบ เก็บข้อมูลพนักงาน (ข้อมูลส่วนตัว เงินเดือน)
> - ระบบลงเวลาเข้างานของพนักงาน
> - ระบบ user ของโปรแกรมนี้
> - เพิ่มเข้าไปด้วยว่า user ไหนเป็นคนสร้าง transaction นั้นๆ
> - ทำระบบ history ด้วยได้ไหมว่า ใครมาแก้อะไรไปบ้าง
>   - transaction มี histoty สำหรับรองรับการเช็คการแก้ไข
>   - สินค้าและบริการ มีบันทึก history การแก้ไขราคา (ใครแก้ แก้เป็นเท่าไหร แก้ไปตอนไหน etc.)

Answers to the clarifying questions:
- Users: one **owner** plus **staff**, and the owner ticks each staff member's permissions.
- Time clock: staff **tap their own name, no PIN**.
- Payroll: the **full** version, with salary advances, late and absence deductions, OT, and per-period pay runs with payment records.

### What was built

The new conventions are in CLAUDE.md, under "Users, permissions and history" and "Data conventions".

**Data** (first added as migration 0002; since §10 part of `drizzle/0000_init.sql`)

New tables:
- `users` (role owner/staff, a permissions JSON array, a scrypt password hash, an optional link to an employee)
- `audit_logs`
- `price_changes`
- `employees`
- `attendance` (one row per clock-in/out session, `source` clock/manual)
- `leaves`
- `salary_advances`
- `payroll_runs`
- `payslips` (a snapshot of the pay type/rate, bank and stats)
- `payslip_items` (earning/deduction lines with qty × rate)

New columns:
- `transactions.created_by / updated_by / voided_by`
- `stock_movements.created_by`

Bills without a creator (none in 0.1.0) show no name.

**Main process** (`electron/api/`)
- `session.ts`:
  - The session lives in main (`ctx.session`).
  - Passwords use scrypt.
  - `currentUser`, `hasPermission`, and `actorOf` (who to stamp on a write).
- `auth.ts`:
  - Status, first-run owner setup, and login with wrong-password throttling.
  - Logout, change password.
  - Owner recovery code: shown once at setup, and can be regenerated.
- `users.ts`: owner-only user management. The last owner cannot be removed or demoted.
- `access.ts`:
  - The `ACCESS` table, with one rule per API method, typed over `ErpHandlers`.
  - `withAccessControl`, used in main.ts around the IPC handlers.
  - Purchases need `purchases.create` (create/edit/void/markPaid of a purchase).
  - `attendance.board/clock` are public, for the time clock.
- `audit.ts`:
  - `writeAudit` / `diffFields` / `initialFields`, plus the `audit.list` feed.
  - Staff without `employees.manage` never see employee/payroll entries.
  - Without `attendance.manage` they also don't see attendance entries.
- `price-history.ts`: product/service sell and cost changes. The sources are manual edit, create, and purchase (a purchase bill updates the cost).
- `employees.ts`, `attendance.ts` (clock in/out, manual sessions, leaves, month summary), `payroll.ts`:
  - Runs, payslips, recalculation, manual lines, pay/unpay, advances.
  - An advance is deducted in the next run automatically.
  - Deleting an unpaid run returns its advances to "waiting".
- Existing APIs changed:
  - Every write records history.
  - Bills stamp the creator/editor/voider.
  - `transactions.list` gained a creator filter.
  - `transactions.markPaid` was added.
  - `reports.summary` returns `salesByUser` (the reports page has a sales-per-user card).
  - `print` gained payslips.
  - Settings gained `security.autoLockMinutes`, `payroll.*` and `print.showStaffName` (receipts print "ผู้ออกบิล").
- `ERP_AUTO_LOGIN=<name>`: dev/screenshot runs only, ignored when `app.isPackaged`.

**Shared**
- `shared/contract/{auth,audit,employees,attendance,payroll}.ts`.
- `shared/dates.ts`: `"YYYY-MM-DD"` helpers.
- `shared/payroll.ts`: pure pay math.
  - Late minutes after a grace period; OT after `workEnd` with a minimum.
  - Prorated monthly salary for mid-period start/end.
  - Absence and unpaid-leave deductions at salary / `daysPerMonth`.
  - Social security at 5% of a wage clamped to 1,650-17,500 baht.

**Renderer**
- `src/lib/auth.tsx` (`useAuth`) and `src/components/auth/*`:
  - `AuthGate` shows the setup, login or app screen.
  - Login tiles, the recovery flow, the change-password dialog, the user menu, `RequirePermission`, auto-lock.
  - `src/lib/unsaved.ts` stops the auto-lock while a bill form has unsaved edits.
- New pages:
  - `/employees/` and `/employees/view/?id=` (tabs for attendance, advances, payslips and history).
  - `/attendance/` (today board, month summary, per-employee day editor, leaves, settings shortcut).
  - `/clock/` (the time clock, reachable from the login screen without logging in).
  - `/payroll/` and `/payroll/view/?id=` (run, payslip editor, pay dialog, print).
  - `/audit/` (the history feed with type/user/date filters).
  - `/print/payslip/` (`src/components/print/print-shell.tsx` is shared with the receipt route).
- Settings gained two sections, "ผู้ใช้งาน" (owner only: users, permissions, auto-lock, recovery code) and "เวลางาน & เงินเดือน".
- Existing pages are permission-aware:
  - The nav, buttons and menus hide what the user may not do.
  - Without `reports.view` the dashboard drops the KPIs, trend, cash-drawer card and unpaid banner; today's bill list and low stock stay.
- `EntityHistoryCard` sits on the bill, product, customer, employee and payroll-run pages.
- Price history (`PriceHistoryTable`) is on the product page and in a dialog on the services page.
- Bills show "โดย <name>" in lists and "ผู้บันทึก" on the bill page.

**Demo data** (`electron/dev/demo-seed.ts`):
- Users: owner "เจ้าของร้าน" / 1234, "พี่ต้น" / 2222 (staff, broad permissions, linked to employee ต้น), and "น้องเมย์" / 1111 (staff, default permissions, linked to เมย์).
- 5 employees with about a month of attendance.
- One paid August run and 2 open advances.

### Verification

- `npm run typecheck` is clean. `npm test` passes 306 tests in 15 files. The new files are `tests/auth`, `history`, `payroll-calc`, `staff` and `upgrade`.
- `npm run build` succeeds (22 static routes).
- E2E against the production build (`scripts/screenshot.mjs --login …`), as staff:
  - FORBIDDEN on void, reports, employees, payroll, users, settings and restore.
  - When the owner edits a staff bill, the creator is kept.
- The receipt, A5 payslip and 80 mm payslip PDFs are correct. The receipt shows "ผู้ออกบิล".
- Clock-in from the time clock works.
- The bill history card shows the field diffs, the added/removed/changed lines, and "บันทึกการชำระเงิน".
- Screenshots of the new pages at 1024×680 look right, logged in as owner (light) and staff (dark). The payroll run table was fixed to fit; the status column used to be clipped.

### Known limitations / open items

1. **Cost prices are still visible to staff**: products list/detail (cost, profit per unit), purchase bills, stock card.
   Hiding them needs a new permission and server-side stripping of cost fields in products/transactions/stock reads. Not done.
2. The monthly summary sums on the transactions list are hidden in the UI without `reports.view`, but `transactions.list`
   (rule `user`) still returns them.
3. Social-security defaults: 5%, wage base 1,650-17,500 baht. 17,500 is the ceiling announced from 2026, and the owner
   should confirm it in ตั้งค่า → เวลางาน & เงินเดือน. Thai tax withholding (ภ.ง.ด.1) is not calculated; add it as a manual line.
4. The time clock has no PIN (the user's choice): anyone at the counter can clock anyone in or out. Every clock event is
   stored with `source: "clock"`, and managers can correct it (the edit is recorded in history).
5. (Superseded by §10: the version restarted at 0.1.0 and the old installers were deleted.)
6. Nothing is committed (the user has not asked).

---

## 10. Session 6 (2026-09-26): users without a password, first release 0.1.0, rename, icon, Thai / English

### Request (verbatim Thai)

> - เพิ่มตัวเลือกการไม่ใช้รหัสผ่านตอนสร้าง user (บางคนต้องการใช้งานแบบไม่ต้อง login ด้วยรหัส)
> - จากรูปทั้ง 2 รูป ทำไมยังเป็นคำว่า electron อยู่หล่ะ แก้เป็น chokchai 4 yangyont 2002 ERP ได้ไหม
> - รูป icon program แก้ให้มันมี BG เป็นรูปทรงเดียวกันกับ app อื่นๆ ได้ไหม
> - เพิ่ม toggle mode เปลี่ยนภาษา  th/en
> - ทำให้ version ปัจจุบันกลายเป็น version แรกสุดเลย

(The two screenshots showed the macOS menu bar and Dock tooltip saying "Electron" while running `npm run dev`.)
Answers to the clarifying questions: the first version is **0.1.0**; data from earlier versions is **not needed and
must be deleted** ("ไม่ต้องใช้ และ ลบทิ้งไปให้หมดเลย").

### What was done

- **Users without a password:** `users.password_hash` is nullable. `LoginTile` / `SessionUser` / `User` carry
  `hasPassword`. Tapping such a tile logs in (auth.login ignores the password); the last user is preselected only
  when they have a password. The owner can create users without one, or remove / set a password later
  (`users.resetPassword` with `password: null`, audit action `password_remove`). The first-run setup has a
  "ไม่ใช้รหัสผ่าน" option (no recovery code then). A user without a password can set one in the user menu (no current
  password needed). Demo: "ช่างเอก" has no password. Tests in tests/auth.test.ts.
- **First release 0.1.0:** package.json version 0.1.0; migrations squashed into drizzle/0000_init.sql (schema
  compared column by column with the old chain: identical apart from the nullable password). `checkSchemaVersion`
  reports `legacy` (only migrations older than the first one); startup deletes such a database and starts a new
  one; restore rejects it (LEGACY_BACKUP_MESSAGE). tests/upgrade.test.ts and the 0001 migration test were removed.
  Deleted on this Mac: dist/ (0.1.0 / 0.2.0 installers), screenshots/ (old runs), ~/Library/Application
  Support/Chokchai4 ERP (test data), the leaked test temp folders (tests/helpers/db.ts now cleans its own).
- **Name:** "Chokchai 4 Yangyont 2002 ERP" everywhere (`APP_NAME`, productName, NSIS shortcut, artifact names
  `Chokchai-4-Yangyont-2002-ERP-…`). The data folder follows the name; `removeLegacyDataDir` deletes the old
  "Chokchai4 ERP" folder at startup (not in tests / screenshot runs). Dev runs use a renamed clone of Electron.app
  (node_modules/.cache/electron-dev; its signature does not cover Info.plist, so it still launches).
- **Icon:** `npm run logo` now writes the macOS tile (squircle, 824² body in 1024², navy gradient, soft shadow, badge
  at 80 %), a Windows tile and the round in-app logo.
- **Thai / English:** see CLAUDE.md "Languages". About 1,900 strings in src/ were wrapped in `tr()` by a one-off
  Babel codemod (merging JSX text with inline values into one template), reviewed by hand, and translated into
  shared/i18n/en.json. Language toggle in the header, on the login / setup screens and in ตั้งค่า → การแสดงผล; document
  language in ตั้งค่า → การพิมพ์ (English documents: "Receipt", amounts in words "Two thousand baht only", default
  footer "Thank you for your business"). Main-process menus and dialogs follow the language. The renderer renders only
  after mount (hydration of the Thai pre-render in English threw React #418). tests/i18n.test.ts checks the dictionary,
  plurals, contexts, template matching and English amounts; tests/ipc.test.ts covers the sync language channel.

### Verification

- `npm run typecheck` clean; `npm test` 323 tests in 15 files pass; `npm run build` OK.
- English sweep of every page (27 routes, `--lang en`): no console errors, no untranslated text reported by
  `window.__i18nMissing()`; the Thai UI is unchanged. English and Thai PDFs (A4 / 80 mm receipt, A5 payslip) checked.

