import { messages } from "@oliginvest/i18n";
import { AuthForm } from "../../../auth/form";
export const metadata = { title: messages.app.register + " — " + messages.app.brand };
export default async function Page() {
  return <AuthForm kind="register" />;
}
