import { messages } from "@oliginvest/i18n";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../../auth/form";
import { gatePath } from "../../../../auth/navigation";
import { getMe } from "../../../../auth/session";
export const metadata = { title: messages.app.code + " — " + messages.app.brand };
export default async function Page() {
  const me = await getMe();
  const gate = gatePath(me);
  if (!me) {
    if (!(await cookies()).has("__Host-oliginvest.two_factor")) redirect("/logowanie");
    return <AuthForm kind="totp" />;
  }
  if (gate && gate !== "/logowanie/2fa") redirect(gate);
  if (!gate) redirect("/");
  return <AuthForm kind="totp" />;
}
