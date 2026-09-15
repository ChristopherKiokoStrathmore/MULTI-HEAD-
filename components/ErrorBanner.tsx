export default function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 sm:p-5"
      role="alert"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-100">Request failed</p>
          {/* The raw error text is shown verbatim — never swallowed. */}
          <p className="mt-1 break-words whitespace-pre-wrap text-sm leading-relaxed text-red-100/85">
            {message}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="btn-secondary shrink-0 px-2.5 py-1 text-xs text-red-100"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
