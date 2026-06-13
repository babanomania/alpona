-- Deterministic synthetic generators (postgres + duckdb).
DELETE FROM usage_events;
DELETE FROM subscriptions;
DELETE FROM accounts;

-- ── Accounts: 600 across industries and regions ────────────────────
INSERT INTO accounts (id, name, industry, region, created_at)
SELECT
  i,
  'Account ' || i,
  CASE (i * 7) % 5
    WHEN 0 THEN 'SaaS' WHEN 1 THEN 'Fintech' WHEN 2 THEN 'Healthcare'
    WHEN 3 THEN 'Retail' ELSE 'Media' END,
  CASE (i * 11) % 4
    WHEN 0 THEN 'Americas' WHEN 1 THEN 'EMEA' WHEN 2 THEN 'APAC' ELSE 'LATAM' END,
  DATE '2023-06-01' + CAST((i * 17) % 720 AS INTEGER)
FROM generate_series(1, 600) AS t(i);

-- ── Subscriptions: one per account; ~1 in 7 has churned ────────────
INSERT INTO subscriptions (id, account_id, plan, seats, mrr, started_at, canceled_at)
SELECT
  i,
  i,
  CASE (i * 13) % 4
    WHEN 0 THEN 'starter' WHEN 1 THEN 'team' WHEN 2 THEN 'business' ELSE 'enterprise' END,
  5 + ((i * 19) % 200),
  CAST(50 + ((i * 37) % 2400) + ((i * 7) % 100) / 100.0 AS DECIMAL(10,2)),
  DATE '2024-01-01' + CAST((i * 23) % 500 AS INTEGER),
  CASE WHEN (i % 7) = 0
    THEN DATE '2024-06-01' + CAST((i * 29) % 360 AS INTEGER)
    ELSE NULL END
FROM generate_series(1, 600) AS t(i);

-- ── Usage: 18k weekly feature-usage rows over the trailing year ────
INSERT INTO usage_events (id, account_id, event_date, feature, events)
SELECT
  i,
  1 + ((i * 11) % 600),
  DATE '2025-06-13' - CAST(((i * 5) % 52) * 7 AS INTEGER),
  CASE (i * 3) % 5
    WHEN 0 THEN 'dashboards' WHEN 1 THEN 'reports' WHEN 2 THEN 'api'
    WHEN 3 THEN 'exports' ELSE 'alerts' END,
  1 + ((i * 31) % 500)
FROM generate_series(1, 18000) AS t(i);
