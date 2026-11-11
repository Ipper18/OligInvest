import { appMessages as defaultM } from "@oliginvest/i18n";
import { useCopy } from "@oliginvest/ui/localization";
import type { ReactNode } from "react";
export function ErrorState({
  title,
  requestId,
  action,
}: {
  title: string;
  requestId?: string | undefined;
  action?: ReactNode;
}) {
  const m = useCopy("appMessages", defaultM);

  return (
    <div className="oi-panel oi-error-state" role="alert">
      <p>{title}</p>
      {requestId && (
        <p>
          {m.requestId}: <span className="num">{requestId}</span>
        </p>
      )}
      {action}
    </div>
  );
}
