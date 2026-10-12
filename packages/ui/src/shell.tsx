import { messages } from "@oliginvest/i18n";
import type { ReactNode } from "react";
import { Disclaimer } from "./compliance.js";
export function LegalFooter() {
  return (
    <footer className="oi-footer">
      <nav aria-label={messages.app.publicNavigation}>
        <a href="/regulamin">{messages.app.terms}</a>
        <a href="/prywatnosc">{messages.app.privacy}</a>
        <a href="/zrodla-danych">{messages.app.sources}</a>
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
  children,
}: {
  navigation: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="oi-shell">
      <a href="#main" className="oi-skip">
        {messages.shell.skipLink}
      </a>
      <header className="oi-shell-header">
        <a className="oi-brand" href="/">
          {messages.app.brand}
        </a>
        {toolbar}
      </header>
      {navigation}
      <main id="main" tabIndex={-1} className="oi-content">
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="oi-public">
      <a href="#main" className="oi-skip">
        {messages.shell.skipLink}
      </a>
      <header>
        <a className="oi-brand" href="/logowanie">
          {messages.app.brand}
        </a>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}
