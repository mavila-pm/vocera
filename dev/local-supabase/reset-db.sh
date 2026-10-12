#!/usr/bin/env bash
# SOLO DESARROLLO LOCAL: recrea la base "vocera_dev" y aplica bootstrap + migraciones.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGHOST=${PGHOST:-/tmp}; PGPORT=${PGPORT:-54329}; DB=${DB:-vocera_dev}
export PGHOST PGPORT PGUSER=postgres
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "alter database $DB set search_path = \"\$user\", public, extensions"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f dev/local-supabase/bootstrap.sql
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "Fallo en $f"; exit 1; }
done
# Clave de cifrado SOLO para desarrollo (generada al vuelo, nunca se guarda en el repo)
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payout_encryption_key')" >/dev/null
echo "OK: $DB lista"
