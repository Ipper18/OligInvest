"use client";

import { appMessages } from "@oliginvest/i18n";
import { type ReactNode, useId, useRef } from "react";
import { Button } from "./native-controls.js";

export function ModalDialog({
  title,
  triggerLabel,
  closeLabel,
  children,
  className = "",
  onOpen,
}: {
  title: string;
  triggerLabel: string;
  closeLabel: string;
  children: ReactNode;
  className?: string;
  onOpen?: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        onClick={() => {
          trigger.current?.focus();
          dialog.current?.showModal();
          onOpen?.();
        }}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={id}
        className={`oi-dialog ${className}`}
        onClose={() => {
          // Native close already restores focus. A delayed close event must not
          // steal it after the user has moved to the next control.
          if (
            document.activeElement === document.body ||
            dialog.current?.contains(document.activeElement)
          ) {
            trigger.current?.focus();
          }
        }}
      >
        <h2 id={id}>{title}</h2>
        {children}
        <form method="dialog">
          <Button type="submit">{closeLabel}</Button>
        </form>
      </dialog>
    </>
  );
}

export function Popover({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="oi-popover-root">
      <Button popoverTarget={id}>{label}</Button>
      <div id={id} popover="auto" className="oi-popover">
        {children}
      </div>
    </div>
  );
}

export function Sheet(props: Parameters<typeof ModalDialog>[0]) {
  return <ModalDialog {...props} className="oi-sheet" />;
}
export function Explainer({
  label,
  onOpen,
  children,
}: {
  label: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <span className="oi-popover-root oi-explainer">
      <button
        type="button"
        className="oi-info"
        aria-label={label}
        popoverTarget={id}
        onClick={onOpen}
      >
        <span aria-hidden="true">{appMessages.informationIcon}</span>
      </button>
      <span id={id} popover="auto" className="oi-popover">
        {children}
      </span>
    </span>
  );
}
