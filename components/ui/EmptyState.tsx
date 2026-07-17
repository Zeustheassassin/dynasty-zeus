import type { ReactNode } from "react";

interface EmptyStateProps {
  children: ReactNode;
  className?: string;
}

/** Shared "nothing here yet" panel — replaces the ~20 independently
 *  hand-written "No ... found" blocks scattered across hub tabs. */
export default function EmptyState({ children, className = "" }: EmptyStateProps) {
  return (
    <div className={`rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400 ${className}`}>
      {children}
    </div>
  );
}
