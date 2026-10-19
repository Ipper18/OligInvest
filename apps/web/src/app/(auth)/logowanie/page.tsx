import { messages } from "@oliginvest/i18n";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../auth/form";
import { authDestination, gatePath } from "../../../auth/navigation";
import { getMe } from "../../../auth/session";
export const metadata = { title: messages.app.signIn + " — " + messages.app.brand };
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
