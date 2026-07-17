interface SkeletonProps {
  className?: string;
}

/** Shared loading placeholder — a bare div sized/positioned by the caller
 *  via className, replacing ad-hoc `animate-pulse` blocks. */
export default function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40 ${className}`} />;
}
