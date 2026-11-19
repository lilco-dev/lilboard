import type { Sql, Row } from "@lilboard/core";

type SqlStorageLike = {
  sql: {
    exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] };
  };
};

// Adapter for the Cloudflare runtime: Durable Object embedded SQLite.
// Note: DO SQLite rejects PRAGMAs — the shared SCHEMA keeps only DDL,
// and any PRAGMAs a runtime needs are its own concern.
export function doSql(storage: SqlStorageLike): Sql {
  return {
    exec(sql: string, ...args: unknown[]) {
      storage.sql.exec(sql, ...args);
    },
    query(sql: string, ...args: unknown[]): Row[] {
      return storage.sql.exec(sql, ...args).toArray() as Row[];
    },
  };
}
