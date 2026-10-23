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
  if (gate && gate !== "/konfiguracja-2fa") redirect(authDestination(gate, returnTo));
  // Session calls do not re-render this route, so the mounted form keeps one-time recovery codes.
  return <AuthForm kind="enable" enrolled={!gate} />;
}
