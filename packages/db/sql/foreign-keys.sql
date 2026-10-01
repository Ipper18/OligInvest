-- PostgreSQL column-specific SET NULL actions and platform → identity references.
ALTER TABLE platform.idempotency_keys ADD CONSTRAINT idempotency_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE portfolio.import_rows ADD CONSTRAINT import_rows_transaction_id_user_id_fkey FOREIGN KEY (transaction_id, user_id) REFERENCES portfolio.transactions(id, user_id) ON DELETE SET NULL (transaction_id);
ALTER TABLE portfolio.journal_entries ADD CONSTRAINT journal_entries_account_id_user_id_fkey FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts(id, user_id) ON DELETE SET NULL (account_id);
ALTER TABLE portfolio.journal_entries ADD CONSTRAINT journal_entries_transaction_id_user_id_fkey FOREIGN KEY (transaction_id, user_id) REFERENCES portfolio.transactions(id, user_id) ON DELETE SET NULL (transaction_id);
ALTER TABLE portfolio.transactions ADD CONSTRAINT transactions_import_batch_id_user_id_fkey FOREIGN KEY (import_batch_id, user_id) REFERENCES portfolio.import_batches(id, user_id) ON DELETE SET NULL (import_batch_id);
ALTER TABLE portfolio.transactions ADD CONSTRAINT transactions_related_transaction_id_user_id_fkey FOREIGN KEY (related_transaction_id, user_id) REFERENCES portfolio.transactions(id, user_id) ON DELETE SET NULL (related_transaction_id);
