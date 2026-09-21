COMMENT ON SCHEMA auth IS 'Better Auth — dostęp wyłącznie dla roli oliginvest_auth (ADR-004)';
COMMENT ON TABLE portfolio.transactions IS 'Źródło prawdy portfela: operacje (obliczenia-finansowe.md § 1)';
COMMENT ON TABLE portfolio.lots IS 'Pochodne: partie FIFO odtwarzane z operacji (zadanie recompute)';
COMMENT ON TABLE portfolio.valuations_daily IS 'Pochodne: dzienne wyceny rachunków — wejście TWR/XIRR';
COMMENT ON TABLE market.bars_daily IS 'Historia EOD; źródło prawdy dla wykresów i analiz (strategia-cache.md)';
COMMENT ON TABLE platform.audit_log IS 'Append-only: rola aplikacji ma tylko INSERT i SELECT';
COMMENT ON TABLE identity.consent_events IS 'Append-only: akceptacje regulaminu, potwierdzenia informacji o przetwarzaniu i zgody (FR-07.12)';
COMMENT ON TABLE platform.erasure_log IS 'UUID usuniętych kont do ponownego usunięcia po odtworzeniu kopii zapasowej (RODO art. 17)';
COMMENT ON VIEW identity.user_directory IS 'Bezpieczne kolumny kont; filtr: admin/system widzi wszystkich, użytkownik siebie';
