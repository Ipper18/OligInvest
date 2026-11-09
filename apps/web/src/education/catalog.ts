import content from "./content.json";
export type EducationEntry = {
  key: string;
  term: string;
  synonyms: string[];
  formula: string;
  href: string;
  definition: string;
  reading: string;
  pitfalls: string;
};
export const entries: EducationEntry[] = content;
export const normalizeTerm = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("ł", "l")
    .replaceAll("Ł", "L")
    .toLocaleLowerCase("pl-PL");
export async function localizedEntries(locale: string): Promise<EducationEntry[]> {
  return locale === "en-US"
    ? (await import("@oliginvest/i18n/education-content-en")).entries
    : entries;
}
export function searchGlossary(query: string, catalog = entries) {
  const needle = normalizeTerm(query.trim());
  return catalog.filter((entry) =>
    normalizeTerm([entry.term, ...entry.synonyms].join(" ")).includes(needle),
  );
}
