-- alpona:dialect=postgres
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
