import type { ReactNode } from 'react';

/** Shared heading rhythm for Agent overview pages (MCP/A2A reference layout). */
export function AgentPageHeader({ title, description, action, back }: {
  title: string;
  description?: string | undefined;
  action?: ReactNode;
  back?: ReactNode;
}) {
  return <div className="mb-5 flex items-start justify-between gap-3">
    <div className="flex min-w-0 items-center gap-3">
      {back}
      <div className="min-w-0">
      <h1 className="text-xl font-semibold">{title}</h1>
      {description ? <p className="mt-1 text-sm text-[var(--muted)]">{description}</p> : null}
      </div>
    </div>
    {action}
  </div>;
}
