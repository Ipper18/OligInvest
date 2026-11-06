// Server-rendered inline icons: they travel in the HTML/RSC payload, not in the shell JS bundle.
const paths = {
  start: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z",
  portfolio:
    "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v2.5M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7.5h15a1 1 0 0 1 1 1V11m0 5h-4a2.5 2.5 0 0 1 0-5h4v5Z",
  market: "M4 20V11m5 9V5m5 15v-7m5 7V8M2 21h20",
  alerts: "M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4a2 2 0 0 0 4 0",
  analytics: "M9 3h6m-5 0v6L4.3 18.8A1.5 1.5 0 0 0 5.6 21h12.8a1.5 1.5 0 0 0 1.3-2.2L14 9V3",
  learn: "m2 9 10-5 10 5-10 5-10-5Zm4 2v5c3 2.5 9 2.5 12 0v-5m4-2v6",
  settings: "M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4m8 2v4",
  admin: "M12 3 4 6v6c0 4.6 3.4 8 8 9 4.6-1 8-4.4 8-9V6l-8-3Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;
export type IconName = keyof typeof paths;
export function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="oi-nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
