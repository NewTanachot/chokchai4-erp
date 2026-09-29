import type { Db, Sqlite } from "../db/client";
import type { Session } from "./session";

/** Everything a namespace implementation needs. Pure data - no Electron objects - so it can run in tests. */
export interface ApiContext {
  db: Db;
  sqlite: Sqlite;
  /** Absolute path of the SQLite file (":memory:" in tests). */
  dbPath: string;
  /** Electron userData dir (a temp dir in tests). */
  userDataPath: string;
  /**
   * Logged-in user (main process only). Writes are stamped with it (created_by, history); access rules are
   * checked at the IPC boundary (./access.ts). Without a user, writes are recorded as the system.
   */
  session: Session;
}
