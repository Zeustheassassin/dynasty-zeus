"use client";

// Shared inline error banner for loader-hook failures (audit batch B9).
// Renders nothing when `message` is falsy, so call sites can drop it in
// unconditionally: <ErrorBanner message={someError} onRetry={reload} />.
export default function ErrorBanner({
  message,
  onRetry,
  className = "",
}: {
  message: string | null | undefined;
  onRetry?: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-300 ${className}`}
    >
      <span className="min-w-0">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded border border-red-600 px-2 py-1 text-xs font-semibold text-red-200 transition hover:border-red-400 hover:text-white"
        >
          Retry
        </button>
      )}
    </div>
  );
}
