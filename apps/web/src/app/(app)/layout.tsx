import type { ReactNode } from "react";
import { requireMe } from "../../auth/session";
import { Providers } from "../../shell/providers";
export default async function Layout({ children }: { children: ReactNode }) {
  const me = await requireMe();
  return <Providers initialMe={me}>{children}</Providers>;
}
