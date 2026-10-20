import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIREMENTS = "docs/00-przeglad/wymagania.md";
const BACKLOG = "docs/08-plan/backlog.md";
const MATRIX = "docs/00-przeglad/macierz-pokrycia.md";

export function expandIds(text) {
  const ids = new Set();
  const pattern = /\b(N?FR-\d{2}\.|BL-)(\d{2,3})\b(?:\s*[–—-]\s*(?:(N?FR-\d{2}\.|BL-))?(\d{2,3})\b)?/g;
  for (const [, prefix, first, endPrefix, last] of text.matchAll(pattern)) {
    if (last && endPrefix && endPrefix !== prefix) {
      throw new Error(`Zakres między różnymi grupami: ${prefix}${first}–${endPrefix}${last}`);
    }
    const end = Number(last ?? first);
    if (end < Number(first) || end - Number(first) > 999) {
      throw new Error(`Nieprawidłowy zakres: ${prefix}${first}–${last}`);
    }
    for (let n = Number(first); n <= end; n++) {
      ids.add(prefix + String(n).padStart(first.length, "0"));
    }
  }
  return ids;
}

function withoutFences(text) {
  let fence;
  return text.split(/\r?\n/).map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) { fence = marker; return ""; }
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length
        && line.trim() === marker) fence = undefined;
      return "";
    }
    return line;
  }).join("\n").replace(/<!--[\s\S]*?-->/g, "");
}

// Split Markdown table cells without treating pipes in code spans as separators.
function cells(line) {
  const result = [];
  let cell = "";
  let ticks = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) {
      cell += line[i] + line[++i];
    } else if (line[i] === "`") {
      let length = 1;
      while (line[i + length] === "`") length++;
      if (!ticks) ticks = length;
      else if (ticks === length) ticks = 0;
      cell += "`".repeat(length);
      i += length - 1;
    } else if (line[i] === "|" && !ticks) {
      result.push(cell.trim());
      cell = "";
    } else cell += line[i];
  }
  result.push(cell.trim());
  return result.slice(1, -1);
}

function rows(text, pattern, path, errors) {
  const result = new Map();
  for (const line of withoutFences(text).split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const row = cells(line.trim());
    if (!pattern.test(row[0] ?? "")) continue;
    if (result.has(row[0])) errors.push(`${path}: Duplikat ${row[0]}`);
    result.set(row[0], row);
  }
  if (!result.size) errors.push(`${path}: pusta tabela identyfikatorów`);
  return result;
}

function linkTargets(text) {
  const targets = [];
  // Reference definitions, including angle-bracket destinations and titles.
  for (const match of text.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) {
    targets.push(match[1] ?? match[2]);
  }
  // Balanced parentheses support local paths such as diagram(v2).svg.
  const starts = /!?\[[^\]\n]*\]\(\s*/g;
  for (const match of text.matchAll(starts)) {
    let i = match.index + match[0].length;
    if (text[i] === "<") {
      const end = text.indexOf(">", i + 1);
      if (end !== -1) targets.push(text.slice(i + 1, end));
      continue;
    }
    let target = "";
    let depth = 0;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\" && i + 1 < text.length) { target += text[++i]; continue; }
      if (ch === "(" ) depth++;
      if (ch === ")") { if (!depth) break; depth--; }
      if (/\s/.test(ch) && !depth) break;
      target += ch;
    }
    targets.push(target);
  }
  return targets;
}

export function checkDocumentation(documents, files) {
  const errors = [];
  for (const [path, content] of documents) {
    const text = withoutFences(content);
    const first = text.split("\n").find((line) => line.trim() && !/^\s*#/.test(line));
    if (!/^\s*(?:\*\*)?Cel:(?:\*\*)?\s+\S/.test(first ?? "")) {
      errors.push(`${path}: dokument musi zaczynać się niepustym zdaniem Cel:`);
    }
    for (const target of linkTargets(text)) {
      if (!target || target.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
      try {
        const destination = decodeURIComponent(target.split(/[?#]/)[0]);
        const resolved = posix.normalize(posix.join(posix.dirname(path), destination)).replace(/\/$/, "");
        if (destination.startsWith("/") || resolved.startsWith("../") || !files.has(resolved)) {
          errors.push(`${path}: niedziałający lokalny link ${target}`);
        }
      } catch {
        errors.push(`${path}: nieprawidłowo zakodowany link ${target}`);
      }
    }
  }
  for (const path of [REQUIREMENTS, BACKLOG, MATRIX]) {
    if (!documents.has(path)) errors.push(`Brak dokumentu źródłowego: ${path}`);
  }
  if ([REQUIREMENTS, BACKLOG, MATRIX].some((path) => !documents.has(path))) return errors;
  const requirements = rows(documents.get(REQUIREMENTS), /^N?FR-\d{2}\.\d{2}$/, REQUIREMENTS, errors);
  const tasks = rows(documents.get(BACKLOG), /^BL-\d{3}$/, BACKLOG, errors);
  const matrix = rows(documents.get(MATRIX), /^N?FR-\d{2}\.\d{2}$/, MATRIX, errors);
  const expected = new Map([...requirements.keys()].map((id) => [id, new Set()]));
  const matrixTaskIds = expandIds(withoutFences(documents.get(MATRIX)).split("\n")
    .filter((line) => line.trim().startsWith("|")).join("\n"));
  for (const id of matrixTaskIds) {
    if (id.startsWith("BL-") && !tasks.has(id)) errors.push(`${MATRIX}: nieznane zadanie ${id} w tabelach`);
  }
  for (const [task, row] of tasks) {
    if (row.length !== 7) { errors.push(`${BACKLOG}: ${task} wymaga 7 kolumn`); continue; }
    const ids = expandIds(row[2]);
    if (!ids.size && row[2] !== "—") errors.push(`${BACKLOG}: ${task} nie wskazuje FR/NFR ani jawnego braku przypisania (—)`);
    if (!matrixTaskIds.has(task)) errors.push(`${MATRIX}: brak zadania ${task} w tabelach`);
    for (const id of ids) {
      if (!requirements.has(id)) errors.push(`${BACKLOG}: ${task}, nieznane wymaganie ${id}`);
      else expected.get(id).add(task);
    }
  }
  const actual = new Map();
  for (const [id, row] of matrix) {
    if (!requirements.has(id)) errors.push(`${MATRIX}: nieznane wymaganie ${id}`);
    if (row.length !== 7) { errors.push(`${MATRIX}: ${id} wymaga 7 kolumn`); continue; }
    const ids = expandIds(row[4]);
    actual.set(id, ids);
    for (const task of ids) {
      if (!tasks.has(task)) errors.push(`${MATRIX}: ${id}, nieznane zadanie ${task}`);
      else if (!expected.get(id)?.has(task)) errors.push(`${MATRIX}: ${id} nie jest przypisane do ${task} w backlogu`);
    }
  }
  for (const [id, expectedTasks] of expected) {
    if (!expectedTasks.size) errors.push(`${BACKLOG}: brak zadania dla ${id}`);
    if (!matrix.has(id)) errors.push(`${MATRIX}: brak wiersza ${id}`);
    for (const task of expectedTasks) {
      if (!actual.get(id)?.has(task)) errors.push(`${MATRIX}: ${id}, brak przypisania ${task}`);
    }
  }
  return errors;
}

function main() {
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
  }).split("\0").filter((path) => path && existsSync(path));
  const files = new Set(paths);
  // Links to directories are valid too. Untracked, nonignored new documents are checked.
  for (const path of paths) {
    let parent = posix.dirname(path);
    while (parent !== ".") { files.add(parent); parent = posix.dirname(parent); }
  }
  const docs = paths.filter((path) => path.endsWith(".md")
    && (path.startsWith("docs/") || !path.includes("/") || /^\.github\/.*README\.md$/.test(path)));
  const documents = new Map(docs.map((path) => [path, readFileSync(path, "utf8")]));
  const errors = checkDocumentation(documents, files);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else console.log(`Dokumentacja: OK (${documents.size} dokumentów; Cel, linki, FR/NFR ↔ BL).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
