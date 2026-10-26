import { messages } from "@oliginvest/i18n";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../auth/form";
import { authDestination, gatePath } from "../../../auth/navigation";
import { getMe } from "../../../auth/session";
export const metadata = { title: messages.app.enrollment + " — " + messages.app.brand };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const me = await getMe();
  const gate = gatePath(me);
  if (gate && gate !== "/konfiguracja-2fa" && gate !== "/akceptacja-regulaminu")
    redirect(authDestination(gate, returnTo));
  // The mounted client preserves one-time recovery codes across cookie rotation.
  // Legal acceptance is enforced after the user has saved those codes; it still
  // gates every data route. A fresh client with no codes follows the normal gate.
  return <AuthForm kind="enable" enrolled={!gate || gate === "/akceptacja-regulaminu"} />;
}
