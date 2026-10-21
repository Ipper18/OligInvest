import { educationMessages as m } from "@oliginvest/i18n/education";
import { Disclaimer } from "@oliginvest/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMe } from "../../../auth/session";
import { OnboardingButton } from "../../../education/onboarding-button";
export default async function Page() {
  const me = await requireMe();
  if (me.features["module.education"] === false || !me.permissions.includes("education:use"))
    notFound();
  return (
    <section>
      <h1>{m.title}</h1>
      <Link href="/nauka/slownik">{m.glossary}</Link>
      <OnboardingButton />
      <Disclaimer disclaimerKey="education" version="2026-09" />
    </section>
  );
}
