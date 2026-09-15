export default function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4" role="alert">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-900">Request failed</p>
          {/* The raw error text is shown verbatim — never swallowed. */}
          <p className="mt-1 break-words whitespace-pre-wrap text-sm text-red-800">{message}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
