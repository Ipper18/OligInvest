// Unit tests keep Vitest's default 5 s limit. A test that scans the repository or processes a large
// synthetic dataset (thousands of rows, every component) gets this explicit budget instead: in CI it
// runs beside every other package and has measured up to 5.8 s for work that takes under 0.5 s on an
// idle machine (packages/i18n compliance scan, 2026-10-20). Use it per test; never raise the global limit.
export const BULK_TEST_TIMEOUT_MS = 30_000;
