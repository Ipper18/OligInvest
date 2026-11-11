import {
  appMessages as defaultAppMessages,
  commonMessages as defaultCommonMessages,
} from "@oliginvest/i18n";
import { useCopy } from "@oliginvest/ui/localization";
import type { ReactNode } from "react";
import { Disclaimer } from "./compliance.js";
export function LegalFooter() {
  const appMessages = useCopy("appMessages", defaultAppMessages);

  return (
    <footer className="oi-footer">
      <nav aria-label={appMessages.publicNavigation}>
        <a href="/regulamin">{appMessages.terms}</a>
        <a href="/prywatnosc">{appMessages.privacy}</a>
        <a href="/zrodla-danych">{appMessages.sources}</a>
      </nav>
      <Disclaimer disclaimerKey="general" version="2026-09" />
    </footer>
  );
}
export function ScreenState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="oi-screen-state">
      <h1>{title}</h1>
      {children}
    </section>
  );
}
export function Skeleton() {
  const appMessages = useCopy("appMessages", defaultAppMessages);

  return (
    <section aria-busy="true" aria-label={appMessages.loading} data-loading-fallback="">
      <div className="oi-kpis" aria-hidden="true">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="oi-skeleton oi-skeleton-tile" />
        ))}
      </div>
      <div className="oi-skeleton" aria-hidden="true" />
    </section>
  );
}
export function AppShell({
  navigation,
  toolbar,
  footer,
  children,
}: {
  navigation: ReactNode;
  toolbar: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const appMessages = useCopy("appMessages", defaultAppMessages);
  const commonMessages = useCopy("commonMessages", defaultCommonMessages);

  return (
    <div className="oi-shell">
      <a href="#main" className="oi-skip">
        {commonMessages.shell.skipLink}
      </a>
      <header className="oi-shell-header">
        <a className="oi-brand" href="/">
          {appMessages.brand}
        </a>
        {toolbar}
      </header>
      {navigation}
      <main id="main" tabIndex={-1} className="oi-content">
        {children}
      </main>
      {footer}
    </div>
  );
}
export function PublicShell({ children }: { children: ReactNode }) {
  const appMessages = useCopy("appMessages", defaultAppMessages);
  const commonMessages = useCopy("commonMessages", defaultCommonMessages);

  return (
    <div className="oi-public">
      <a href="#main" className="oi-skip">
        {commonMessages.shell.skipLink}
      </a>
      <header>
        <a className="oi-brand" href="/logowanie">
          {appMessages.brand}
        </a>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}
