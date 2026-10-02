#!/bin/sh
set -eu
PGBACKREST_REPO1_CIPHER_PASS="$(cat /run/secrets/PGBACKREST_REPO1_CIPHER_PASS)"
export PGBACKREST_REPO1_CIPHER_PASS
unset PGBACKREST_REPO1_CIPHER_PASS_FILE
exec pgbackrest --stanza=oliginvest "$@"
