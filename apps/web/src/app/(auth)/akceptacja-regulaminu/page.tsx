import { messages } from "@oliginvest/i18n";
import { redirect } from "next/navigation";
import { getApiClient } from "../../../api/server";
import { legalSchema } from "../../../api/validation";
import { AuthForm } from "../../../auth/form";
import { authDestination, gatePath } from "../../../auth/navigation";
import { getMe } from "../../../auth/session";
export const metadata = { title: messages.app.termsTitle + " — " + messages.app.brand };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const me = await getMe();
  const gate = gatePath(me);
  if (gate !== "/akceptacja-regulaminu") redirect(authDestination(gate, returnTo));
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
