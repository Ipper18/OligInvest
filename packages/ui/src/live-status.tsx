import type { ReactElement } from "react";

/**
 * `reserve` lists every label the status can show. They share one grid cell and only the current
 * one is visible, so the toolbar keeps its width (and line wrapping) when the label changes after
 * hydration — otherwise the whole page shifts on narrow screens (Lighthouse CLS).
 */
export function LiveStatus({
  label,
  reserve = [],
  actionLabel,
  actionName,
  onAction,
}: {
  label: string;
  reserve?: readonly string[];
  actionLabel: string;
  actionName: string;
  onAction: () => void;
}): ReactElement {
  return (
    <div className="oi-live-status">
      <span role="status" className="oi-connection">
        <span aria-hidden="true" className="oi-status-dot" />
        <span className="oi-connection-label">
          {reserve
            .filter((other) => other !== label)
            .map((other) => (
              <span key={other} aria-hidden="true" className="oi-connection-reserve">
                {other}
              </span>
            ))}
          <span className="oi-connection-current">{label}</span>
        </span>
      </span>
      <button type="button" className="oi-live-action" aria-label={actionName} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
