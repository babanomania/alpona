#!/bin/bash
# First-boot setup: roles, database, read-only grants, and the specs
# table with RLS (the same migration documented for hosted Supabase).
set -e

psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-supabase_admin}" -d postgres <<SQL
CREATE ROLE alpona LOGIN PASSWORD '${ALPONA_DB_PASSWORD:-alpona}';
CREATE ROLE alpona_reader LOGIN PASSWORD '${ALPONA_READER_PASSWORD:-alpona_reader}';
CREATE DATABASE alpona OWNER alpona;

-- Standard Supabase role set. GoTrue's bundled migrations GRANT to these
-- (postgres / anon / authenticated / service_role); without them the
-- auth service crash-loops. Roles are cluster-global, created once here.
DO \$\$ BEGIN
  CREATE ROLE postgres SUPERUSER LOGIN PASSWORD '${POSTGRES_PASSWORD:-alpona-super-secret}';
EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
SQL

psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-supabase_admin}" -d alpona <<SQL
ALTER SCHEMA public OWNER TO alpona;
GRANT USAGE ON SCHEMA public TO alpona_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE alpona IN SCHEMA public
  GRANT SELECT ON TABLES TO alpona_reader;

-- auth.uid() exists on hosted Supabase; stub it here so the same RLS
-- migration applies unchanged.
DO \$\$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
  END IF;
END
\$\$;
SQL

psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-supabase_admin}" -d alpona -f /specs/0001_specs.sql
psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-supabase_admin}" -d alpona -c 'ALTER TABLE alpona_specs OWNER TO alpona;'
