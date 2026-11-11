import { educationMessages as defaultM } from "@oliginvest/i18n/education";
import { Disclaimer } from "@oliginvest/ui";
import { getLocalization } from "@oliginvest/ui/localization-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMe } from "../../../auth/session";
import { entries } from "../../../education/catalog";
import { OnboardingButton } from "../../../education/onboarding-button";
export default async function Page() {
  const m =
    ((await getLocalization()).copies["educationMessages"] as typeof defaultM | undefined) ??
    defaultM;

  const me = await requireMe();
  if (
    !entries.length ||
    me.features["module.education"] === false ||
    !me.permissions.includes("education:use")
  )
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
