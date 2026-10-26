import { educationMessages as m } from "@oliginvest/i18n/education";
import { Disclaimer } from "@oliginvest/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMe } from "../../../../../auth/session";
import { entries } from "../../../../../education/catalog";
import { EntryView } from "../../../../../education/entry-view";
export default async function Page({ params }: { params: Promise<{ termin: string }> }) {
  const me = await requireMe();
  if (me.features["module.education"] === false || !me.permissions.includes("education:use"))
    notFound();
  const { termin } = await params;
  const entry = entries.find((item) => item.key === termin);
  if (!entry) notFound();
  return (
    <section>
      <h1>{entry.term}</h1>
      <EntryView entry={entry} />
      <Link href={entry.href}>{m.appLink}</Link>
      <Link href="/nauka/slownik">{m.glossary}</Link>
      <Disclaimer disclaimerKey="education" version="2026-09" />
    </section>
  );
}
