"use client";
import type { ReactElement } from "react";
import { Button } from "./native-controls.js";
export function PrintButton({ label }: { label: string }): ReactElement {
  return <Button onClick={() => window.print()}>{label}</Button>;
}
