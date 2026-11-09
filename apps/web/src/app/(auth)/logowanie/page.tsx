import { messages as defaultMessages } from "@oliginvest/i18n";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../auth/form";
import { authDestination, gatePath } from "../../../auth/navigation";
import { getMe } from "../../../auth/session";
export async function generateMetadata() {
  const messages =
    ((await getLocalization()).copies["messages"] as typeof defaultMessages | undefined) ??
    defaultMessages;
  return { title: messages.app.signIn + " — " + messages.app.brand };
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const me = await getMe();
  const gate = gatePath(me);
  if (me && gate !== "/logowanie") redirect(authDestination(gate, returnTo));
  return <AuthForm kind="signIn" />;
}
