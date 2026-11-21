import Link from "next/link";
import { NavLink } from "@lilco/ui";
import styles from "./board.module.css";

export function SpaceSwitcher({ current, spaces }: { current: string; spaces: string[] }) {
  return (
    <details className={styles.spaceSwitcher} key={current}>
      <summary className={styles.spaceButton}>
        <span className="lil-eyebrow">Space</span>
        <strong>{current}</strong>
        <span aria-hidden="true">▾</span>
      </summary>
      <div role="group" aria-label="Switch space" className={styles.spaceMenu}>
        {spaces.map((space) =>
          space === current ? (
            <span key={space} className={styles.currentSpace} aria-current="page">{space}</span>
          ) : (
            <NavLink as={Link} key={space} href={`?${new URLSearchParams({ board: space })}`}>{space}</NavLink>
          )
        )}
      </div>
    </details>
  );
}
