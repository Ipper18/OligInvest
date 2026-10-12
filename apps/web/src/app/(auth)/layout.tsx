import { PublicShell } from "@oliginvest/ui";
import type { ReactNode } from "react";
export default function Layout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
