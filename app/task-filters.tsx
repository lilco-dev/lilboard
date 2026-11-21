"use client";

import { useRouter } from "next/navigation";
import { startTransition, useOptimistic, type ReactNode } from "react";
import styles from "./board.module.css";

type Filters = { state: string; channel: string; label: string };
type Option = { value: string; title: string };

export type TaskFilterProps = {
  board: string;
  filters: Filters;
  statuses: readonly Option[];
  channels: string[];
  labels: Option[];
};

export function TaskFilters({ board, filters, statuses, channels, labels, density }: TaskFilterProps & { density: ReactNode }) {
  const router = useRouter();
  const [selected, setSelected] = useOptimistic(filters);

  function apply(next: Filters) {
    const query = new URLSearchParams({ board, view: "tasks" });
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
    }
    startTransition(() => {
      setSelected(next);
      router.push(`?${query}`, { scroll: false });
    });
  }

  const options = [
    { key: "state", name: "Status", values: statuses },
    { key: "channel", name: "Chat", values: channels.map((value) => ({ value, title: `#${value}` })) },
    { key: "label", name: "Label", values: labels },
  ] as const;
  const any = selected.state || selected.channel || selected.label;

  return (
    <div className={styles.taskToolbar}>
      <div className={styles.taskFilters} role="group" aria-label="Filter tasks">
        {options.map(({ key, name, values }) => (
          <label key={key}>
            <span className="lil-eyebrow">{name}</span>
            <select value={selected[key]} onChange={(event) => apply({ ...selected, [key]: event.target.value })}>
              <option value="">All</option>
              {values.map(({ value, title }) => <option key={value} value={value}>{title}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className={styles.taskActions}>
        {any && (
          <button className={styles.clearFilters} type="button" onClick={() => apply({ state: "", channel: "", label: "" })}>
            Clear filters
          </button>
        )}
        {density}
      </div>
    </div>
  );
}
