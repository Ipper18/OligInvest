import { appMessages, commonMessages } from "@oliginvest/i18n";
import type { ReactNode } from "react";
import { Disclaimer } from "./compliance.js";
export function LegalFooter() {
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
  return (
    <section aria-busy="true">
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
