"use client";

import { type ReactNode, useId, useRef } from "react";
import { Button } from "./native-controls.js";

export function ModalDialog({
  title,
  triggerLabel,
  closeLabel,
  children,
}: {
  title: string;
  triggerLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={trigger} onClick={() => dialog.current?.showModal()}>
        {triggerLabel}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={id}
        className="oi-dialog"
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
