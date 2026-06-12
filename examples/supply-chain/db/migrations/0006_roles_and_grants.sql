-- alpona:dialect=postgres
-- The security backstop: even if every guardrail above it failed, the
-- database itself refuses writes from the role the server connects as.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'alpona_reader') THEN
    CREATE ROLE alpona_reader LOGIN PASSWORD 'alpona_reader';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE alpona TO alpona_reader;
GRANT USAGE ON SCHEMA public TO alpona_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO alpona_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO alpona_reader;
