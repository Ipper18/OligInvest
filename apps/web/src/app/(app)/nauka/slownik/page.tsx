import { educationMessages as defaultM } from "@oliginvest/i18n/education";
import { Disclaimer } from "@oliginvest/ui";
import { getLocalization } from "@oliginvest/ui/localization-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMe } from "../../../../auth/session";
import { entries, localizedEntries, searchGlossary } from "../../../../education/catalog";
import type { SearchParams } from "../../../../portfolio/page";
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
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
  const query = (await searchParams).q ?? "";
  if (typeof query !== "string" || query.length > 100) notFound();
  const items = searchGlossary(query, await localizedEntries(me.preferences.locale));
  return (
    <section>
      <h1>{m.glossary}</h1>
      <form className="oi-filters" method="get">
        <label>
          {m.search}
          <input name="q" type="search" maxLength={100} defaultValue={query} />
        </label>
        <button className="oi-button" type="submit">
          {m.submit}
        </button>
      </form>
      {items.length ? (
        <ul>
          {items.map((entry) => (
            <li key={entry.key}>
              <Link prefetch={false} href={`/nauka/slownik/${entry.key}`}>
                {entry.term}
              </Link>
              <p>{entry.definition}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>{m.empty}</p>
      )}
      <Disclaimer disclaimerKey="education" version="2026-09" />
    </section>
  );
}
