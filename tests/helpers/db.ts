import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { createCoreApi } from "../../electron/api";
import type { ApiContext } from "../../electron/api/context";
import { newSession } from "../../electron/api/session";
import { openDatabase } from "../../electron/db/client";
import { runMigrations } from "../../electron/db/migrate";
import { seedDefaults } from "../../electron/db/seed";

/** One temp folder per test file for the test APIs' userData, removed after the file's tests. */
let tempRoot: string | null = null;
afterAll(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});
function testUserData(): string {
  tempRoot ??= fs.mkdtempSync(path.join(os.tmpdir(), "chokchai4-test-"));
  return fs.mkdtempSync(path.join(tempRoot, "api-"));
}

/** Fresh in-memory database with migrations (+ default seed unless disabled) and the full core API. */
export function createTestApi(opts: { seed?: boolean } = {}) {
  const { sqlite, db } = openDatabase(":memory:");
  runMigrations(db, path.resolve(__dirname, "../../drizzle"));
  if (opts.seed !== false) seedDefaults(db);
  const userDataPath = testUserData();
  const ctx: ApiContext = { db, sqlite, dbPath: ":memory:", userDataPath, session: newSession() };
  const api = createCoreApi(ctx);
  return { ctx, db, sqlite, api, close: () => sqlite.close() };
}
