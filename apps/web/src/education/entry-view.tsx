import { educationMessages as m } from "@oliginvest/i18n/education";
import Link from "next/link";
import type { EducationEntry } from "./catalog";

const formulaLink = (entry: EducationEntry) => {
  const line =
    ({ "9": 344, "6": 267, "5": 231, "4": 192, "3": 122, "2": 88 } as Record<string, number>)[
      entry.formula
    ] ?? 13;
  return `https://github.com/Ipper18/OligInvest/blob/main/docs/03-dane/obliczenia-finansowe.md#L${line}`;
};
export function EntryView({ entry }: { entry: EducationEntry }) {
  return (
    <dl>
      <dt>{m.definition}</dt>
      <dd>{entry.definition}</dd>
      <dt>{m.reading}</dt>
      <dd>{entry.reading}</dd>
      <dt>{m.pitfalls}</dt>
      <dd>{entry.pitfalls}</dd>
      <dt>{m.formula}</dt>
      <dd>
        <a href={formulaLink(entry)}>{m.formula}</a>
      </dd>
      <dt>{m.glossaryLink}</dt>
      <dd>
        <Link prefetch={false} href={`/nauka/slownik/${entry.key}`}>
          {entry.term}
        </Link>
      </dd>
    </dl>
  );
}
