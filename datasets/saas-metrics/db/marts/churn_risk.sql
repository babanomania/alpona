-- One row per account with lifetime, MRR, and churn state — the first
-- stop for churn, retention, and at-risk questions.
CREATE OR REPLACE VIEW churn_risk AS
SELECT
  a.name AS account,
  a.industry,
  a.region,
  s.plan,
  s.mrr,
  s.seats,
  CASE WHEN s.canceled_at IS NULL THEN 0 ELSE 1 END AS churned,
  CAST(COALESCE(s.canceled_at, DATE '2025-06-13') - s.started_at AS INTEGER) AS lifetime_days
FROM accounts a
JOIN subscriptions s ON s.account_id = a.id;
