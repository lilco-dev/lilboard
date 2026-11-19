import type { Sql, Row } from "../sql";

// Structural shape of node:sqlite's DatabaseSync — declared, not imported,
// so this package carries no Node type dependency.
type NodeDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
};

// Adapter for the self-host runtime: Next.js + node:sqlite.
export function nodeSql(db: NodeDatabase): Sql {
  return {
    exec(sql: string, ...args: unknown[]) {
      db.prepare(sql).run(...args);
    },
    query(sql: string, ...args: unknown[]): Row[] {
      return db.prepare(sql).all(...args) as Row[];
    },
  };
}
