import { messages } from "@oliginvest/i18n";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../../auth/form";
import { authDestination, gatePath } from "../../../../auth/navigation";
import { getMe } from "../../../../auth/session";
export const metadata = { title: messages.app.code + " — " + messages.app.brand };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const me = await getMe();
  const gate = gatePath(me);
  if (!me) {
    if (!(await cookies()).has("__Host-oliginvest.two_factor"))
      redirect(authDestination(gate, returnTo));
    return <AuthForm kind="totp" />;
  }
  // A verified session reaching this page (reload, history) continues to its destination.
  if (gate !== "/logowanie/2fa") redirect(authDestination(gate, returnTo));
  return <AuthForm kind="totp" />;
}
