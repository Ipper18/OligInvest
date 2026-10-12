import { messages } from "@oliginvest/i18n";
import { redirect } from "next/navigation";
import { getApiClient } from "../../../api/server";
import { legalSchema } from "../../../api/validation";
import { AuthForm } from "../../../auth/form";
import { gatePath } from "../../../auth/navigation";
import { getMe } from "../../../auth/session";
export const metadata = { title: messages.app.termsTitle + " — " + messages.app.brand };
export default async function Page() {
  const me = await getMe();
  const gate = gatePath(me);
  if (!me) redirect("/logowanie");
  if (gate && gate !== "/akceptacja-regulaminu") redirect(gate);
  if (!gate) redirect("/");
  const api = await getApiClient();
  const result = await api.GET("/me/legal");
  if (!result.response.ok) throw new Error("LEGAL_UNAVAILABLE");
  const legal = legalSchema.parse(result.data);
  return (
    <AuthForm
      kind="accept"
      termsVersion={legal.terms.currentVersion}
      privacyVersion={legal.privacyNotice.currentVersion}
    />
  );
}
