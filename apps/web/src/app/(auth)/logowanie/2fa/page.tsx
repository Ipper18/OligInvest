import { messages as defaultMessages } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../../auth/form";
import { authDestination, gatePath } from "../../../../auth/navigation";
import { getMe } from "../../../../auth/session";
export async function generateMetadata() {
  const messages =
    ((await getLocalization()).copies["messages"] as typeof defaultMessages | undefined) ??
    defaultMessages;
  return { title: messages.app.code + " — " + messages.app.brand };
}
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
