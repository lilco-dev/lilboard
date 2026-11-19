export type Row = Record<string, unknown>;
export type Labels = Record<string, string>;

// The minimal surface both SQLite dialects expose. Implementations:
//   packages/core/src/adapters/node.ts  — node:sqlite (self-host)
//   worker/src/sql-do.ts                — ctx.storage.sql (Cloudflare DO)
export interface Sql {
  exec(sql: string, ...args: unknown[]): void;
  query(sql: string, ...args: unknown[]): Row[];
}

export function one(sql: Sql, query: string, ...args: unknown[]): Row | undefined {
  return sql.query(query, ...args)[0];
}

// Works on both runtimes: neither exposes lastInsertRowid on its cursor.
export function lastId(sql: Sql): number {
  return Number((one(sql, "SELECT last_insert_rowid() AS id") as { id: number }).id);
}
