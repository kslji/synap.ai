/**
 * Database module (stub)
 *
 * TODO: Replace with actual encrypted SQLite connection from the Electron
 *       main-process store once the tiered-chat-storage feature is wired up.
 *
 * The functions below expose a better-sqlite3-style synchronous API so that
 * chat-storage-optimizer.ts can compile and be exercised in unit tests.
 */

export interface Statement {
  all(...params: any[]): any[];
  get(...params: any[]): any;
  run(...params: any[]): { changes: number; lastInsertRowid: number };
}

export function prepare(sql: string): Statement {
  // Stub – throws at runtime until the real DB layer is connected.
  throw new Error(
    `db.prepare() is not yet implemented. SQL: ${sql.slice(0, 80)}…`
  );
}
