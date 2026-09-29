import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;
export type Sqlite = Database.Database;
/** The `tx` object inside db.transaction((tx) => ...). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the db or an open transaction - helpers that may run inside a transaction accept this. */
export type DbLike = Db | Tx;

export function openDatabase(filename: string): { sqlite: Sqlite; db: Db } {
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export { schema };
