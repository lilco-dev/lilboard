"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { TaskFilters, type TaskFilterProps } from "./task-filters";
import styles from "./board.module.css";

const densityKey = "lilboard.taskDensity";
const modes = [
  ["compact", "Compact"],
  ["relaxed", "Relaxed"],
] as const;
type Density = (typeof modes)[number][0];

let unsaved: Density | undefined;

function readDensity(): Density {
  if (unsaved !== undefined) return unsaved;
  try {
    return localStorage.getItem(densityKey) === "compact" ? "compact" : "relaxed";
  } catch {
    return "relaxed";
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(densityKey, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(densityKey, listener);
    window.removeEventListener("storage", listener);
  };
}

function setDensity(value: Density) {
  try {
    localStorage.setItem(densityKey, value);
    unsaved = undefined;
  } catch {
    unsaved = value;
  }
  window.dispatchEvent(new Event(densityKey));
}

export function TaskDensity({ filters, children }: { filters: TaskFilterProps; children: ReactNode }) {
  const density = useSyncExternalStore(subscribe, readDensity, () => "relaxed");

  return (
    <div data-task-density={density}>
      <TaskFilters {...filters} density={
        <div className={styles.densitySwitch} role="group" aria-label="Task density">
          {modes.map(([value, label]) => (
            <button type="button" key={value} aria-pressed={value === density} onClick={() => setDensity(value)}>
              {label}
            </button>
          ))}
        </div>
      } />
      {children}
    </div>
  );
}
