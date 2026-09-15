export default function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="rounded-[1.2rem] bg-surface ring-1 ring-accent/30" role="alert">
      <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-accent">Request failed</p>
          {/* The raw error text is shown verbatim — never swallowed. */}
          <p className="mt-1.5 break-words whitespace-pre-wrap text-[14px] leading-relaxed text-ink/80">
            {message}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-[13px] font-medium text-muted transition-colors hover:text-ink"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
