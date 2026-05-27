import type { ReactNode } from "react";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="flex flex-col h-screen">
      <main className="flex-1 overflow-hidden">{children}</main>
      <div
        className="shrink-0 px-3 py-1.5 text-center text-xs"
        style={{ color: "var(--color-muted)", background: "var(--color-panel)", borderTop: "1px solid var(--color-line)" }}
      >
        <a
          href="https://freeappstore.online"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
          style={{ color: "var(--color-muted)" }}
        >
          Part of FreeAppStore — free forever
        </a>
      </div>
    </div>
  );
}
