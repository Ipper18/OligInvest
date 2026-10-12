"use client";
import { Button } from "@oliginvest/ui";
export function PrintButton({ label }: { label: string }) {
  return <Button onClick={() => window.print()}>{label}</Button>;
}
