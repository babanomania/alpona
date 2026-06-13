-- Alpona specs table — Supabase deploy mode.
--
-- The Alpona server connects with its own role and enforces ownership in
-- SQL; these RLS policies additionally protect the table when accessed
-- through Supabase clients (PostgREST / supabase-js), where `owner` holds
-- the Supabase Auth user id (auth.uid()).

CREATE TABLE IF NOT EXISTS alpona_specs (
  id text PRIMARY KEY,
  name text NOT NULL,
  prompt text,
  owner text,
  is_public boolean NOT NULL DEFAULT false,
  dictionary_id text,
  spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alpona_specs_owner_idx ON alpona_specs (owner);
CREATE INDEX IF NOT EXISTS alpona_specs_dictionary_idx ON alpona_specs (dictionary_id);

ALTER TABLE alpona_specs ENABLE ROW LEVEL SECURITY;

-- Owners read and write their own specs.
CREATE POLICY alpona_specs_owner_all ON alpona_specs
  FOR ALL
  USING (owner = (SELECT auth.uid()::text))
  WITH CHECK (owner = (SELECT auth.uid()::text));

-- Anyone may read public specs (the share/fork path).
CREATE POLICY alpona_specs_public_read ON alpona_specs
  FOR SELECT
  USING (is_public);
