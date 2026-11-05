export function LiveStatus({
  label,
  actionLabel,
  actionName,
  onAction,
}: {
  label: string;
  actionLabel: string;
  actionName: string;
  onAction: () => void;
}) {
  return (
    <div className="oi-live-status">
      <span role="status" className="oi-connection">
        <span aria-hidden="true" className="oi-status-dot" />
        {label}
      </span>
      <button type="button" className="oi-live-action" aria-label={actionName} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
