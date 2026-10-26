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
export function searchGlossary(query: string) {
  const needle = normalizeTerm(query.trim());
  return entries.filter((entry) =>
    normalizeTerm([entry.term, ...entry.synonyms].join(" ")).includes(needle),
  );
}
