import type { ComponentType, ReactNode } from "react";

type LinkRenderer = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page" | "true";
}> | "a";

export function Masthead({ brand, children }: { brand: string; children?: ReactNode }) {
  return (
    <header className="lil-masthead">
      <div className="lil-masthead-inner">
        <div className="lil-masthead-brand">
          <span className="lil-mark" aria-hidden="true">l</span>
          <span>{brand}</span>
        </div>
        {children}
      </div>
    </header>
  );
}

export function Section({
  id,
  title,
  meta,
  children,
}: {
  id: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="lil-section" aria-labelledby={id}>
      <header className="lil-section-header">
        <h2 id={id}>{title}</h2>
        {meta}
      </header>
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "attention";
}) {
  return <span className="lil-badge" data-tone={tone}>{children}</span>;
}

export function FilterLink({
  href,
  current,
  as: Link = "a",
  children,
}: {
  href: string;
  current: boolean;
  as?: LinkRenderer;
  children: ReactNode;
}) {
  return (
    <Link className="lil-filter" href={href} aria-current={current ? "true" : undefined}>
      {children}
    </Link>
  );
}

export function Workspace({
  navigation,
  inspector,
  children,
}: {
  navigation: ReactNode;
  inspector?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="lil-workspace" data-inspecting={inspector ? "" : undefined}>
      <a className="lil-skip" href={inspector ? "#workspace-inspector" : "#workspace-content"}>
        {inspector ? "Skip to details" : "Skip to content"}
      </a>
      <nav className="lil-rail" aria-label="Space navigation">{navigation}</nav>
      {inspector}
      <main id="workspace-content" className="lil-workspace-main" tabIndex={-1}>{children}</main>
    </div>
  );
}

export function NavGroup({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `lil-nav-group ${className}` : "lil-nav-group"}>
      <h2 className="lil-eyebrow">{title}</h2>
      <div className="lil-nav-items">{children}</div>
    </div>
  );
}

export function NavLink({ href, current, as: Link = "a", children }: {
  href: string;
  current?: boolean;
  as?: LinkRenderer;
  children: ReactNode;
}) {
  return <Link className="lil-nav-link" href={href} aria-current={current ? "page" : undefined}>{children}</Link>;
}

export function Inspector({
  heading,
  closeHref,
  as: Link = "a",
  children,
}: {
  heading: ReactNode;
  closeHref: string;
  as?: LinkRenderer;
  children: ReactNode;
}) {
  return (
    <aside id="workspace-inspector" className="lil-inspector" aria-labelledby="inspector-title" tabIndex={-1}>
      <header className="lil-inspector-header">
        <h2 id="inspector-title">{heading}</h2>
        <Link href={closeHref}>Close</Link>
      </header>
      {children}
    </aside>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="lil-empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
