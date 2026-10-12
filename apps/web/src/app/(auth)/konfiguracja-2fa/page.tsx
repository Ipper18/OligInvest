import { messages } from "@oliginvest/i18n";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../auth/form";
import { gatePath } from "../../../auth/navigation";
import { getMe } from "../../../auth/session";
export const metadata = { title: messages.app.enrollment + " — " + messages.app.brand };
export default async function Page() {
  const me = await getMe();
  const gate = gatePath(me);
  if (!me) redirect("/logowanie");
  if (gate && gate !== "/konfiguracja-2fa") redirect(gate);
  if (!gate) redirect("/");
  return <AuthForm kind="enable" />;
}
