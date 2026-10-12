import { messages } from "@oliginvest/i18n";
import { AuthForm } from "../../../auth/form";
export const metadata = { title: messages.app.reset + " — " + messages.app.brand };
export default async function Page() {
  return <AuthForm kind="requestReset" />;
}
