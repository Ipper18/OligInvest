import { messages } from "@oliginvest/i18n";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../auth/form";
import { gatePath } from "../../../auth/navigation";
import { getMe } from "../../../auth/session";
export const metadata = { title: messages.app.signIn + " — " + messages.app.brand };
export default async function Page() {
  const me = await getMe();
  const gate = gatePath(me);
  if (me && gate !== "/logowanie") redirect(gate ?? "/");
  return <AuthForm kind="signIn" />;
}
