/**
 * Data of the pre-release test builds (0.1.0 / 0.2.0 before the first release, then named "Chokchai4 ERP"). The
 * first release (0.1.0) starts with an empty database and deletes that data, as the shop asked.
 */
import fs from "node:fs";
import path from "node:path";

/** userData folder name of the test builds (their app name). */
export const LEGACY_DATA_DIR = "Chokchai4 ERP";

/** Deletes `<appData>/Chokchai4 ERP` (database, backups, browser storage), never the folder in use. */
export function removeLegacyDataDir(appDataPath: string, userDataPath: string): boolean {
  const dir = path.join(appDataPath, LEGACY_DATA_DIR);
  if (path.resolve(dir) === path.resolve(userDataPath) || !fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Deletes a SQLite database file with its WAL / shared-memory / journal sidecars. */
export function removeDatabaseFiles(dbPath: string): void {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) fs.rmSync(f, { force: true });
}
