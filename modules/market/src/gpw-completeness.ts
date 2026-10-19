// ADR-005 verification (BL-213): over 20 consecutive GPW sessions after M2, at least 95 % of days
// must have complete EOD data fetched automatically from the archive. Counts are instrument
// rows, not money, so plain integers are exact here.
export const GPW_COMPLETENESS_SESSIONS = 20;
export const GPW_COMPLETENESS_TARGET = 0.95;
/** A day is complete when automatic rows reach 95 % of the window's median non-empty day. */
export const GPW_DAY_COMPLETE_RATIO = 0.95;
export interface GpwSessionCount {
  date: string;
  /** Rows stored from the archive by the scheduled job (`source = 'gpw'`). */
  automatic: number;
  /** Rows imported by an administrator (`source = 'gpw_manual'`); they do not count as automatic. */
  manual: number;
  /** The single archive request for the date was claimed (AOF marker), whatever its outcome. */
  requested: boolean;
}
export type GpwSessionStatus = "complete" | "partial" | "manual" | "missing";
export interface GpwCompletenessReport {
  asOf: string;
  sessions: Array<GpwSessionCount & { status: GpwSessionStatus }>;
  referenceCount: number;
  completeSessions: number;
  ratio: number;
  verdict: "pass" | "fail" | "insufficient";
}
export function summarizeGpwCompleteness(
  rows: readonly GpwSessionCount[],
  asOf: string,
): GpwCompletenessReport {
  const window = [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-GPW_COMPLETENESS_SESSIONS);
  const filled = window
    .map((row) => row.automatic)
    .filter((count) => count > 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(filled.length / 2);
  const referenceCount = filled.length
    ? filled.length % 2
      ? (filled[middle] ?? 0)
      : Math.round(((filled[middle - 1] ?? 0) + (filled[middle] ?? 0)) / 2)
    : 0;
  const threshold = Math.ceil(referenceCount * GPW_DAY_COMPLETE_RATIO);
  const sessions = window.map((row) => ({
    ...row,
    status: (row.automatic > 0 && row.automatic >= threshold
      ? "complete"
      : row.automatic > 0
        ? "partial"
        : row.manual > 0
          ? "manual"
          : "missing") as GpwSessionStatus,
  }));
  const completeSessions = sessions.filter((row) => row.status === "complete").length;
  const ratio = window.length ? completeSessions / window.length : 0;
  return {
    asOf,
    sessions,
    referenceCount,
    completeSessions,
    ratio,
    verdict:
      window.length < GPW_COMPLETENESS_SESSIONS
        ? "insufficient"
        : ratio >= GPW_COMPLETENESS_TARGET
          ? "pass"
          : "fail",
  };
}
/** Markdown table for the session report (docs/08-plan); facts only, no portfolio data. */
export function formatGpwCompleteness(report: GpwCompletenessReport): string {
  const percent = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
  const label: Record<GpwSessionStatus, string> = {
    complete: "komplet",
    partial: "niepełne",
    manual: "tylko import ręczny",
    missing: "brak",
  };
  return [
    `Raport kompletności EOD GPW (ADR-005) na ${report.asOf}: ${report.completeSessions}/${report.sessions.length} sesji z kompletem (${percent(report.ratio)}; próg ${percent(GPW_COMPLETENESS_TARGET)} z ${GPW_COMPLETENESS_SESSIONS} sesji) — werdykt: ${{ pass: "PASS", fail: "FAIL", insufficient: "za mało sesji" }[report.verdict]}. Odniesienie: mediana ${report.referenceCount} wierszy.`,
    "",
    "| Sesja | Wiersze automatyczne | Wiersze ręczne | Żądanie archiwum | Stan |",
    "|---|---|---|---|---|",
    ...report.sessions.map(
      (row) =>
        `| ${row.date} | ${row.automatic} | ${row.manual} | ${row.requested ? "tak" : "nie"} | ${label[row.status]} |`,
    ),
  ].join("\n");
}
