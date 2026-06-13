-- Active MRR, accounts, and seats by plan — the first stop for revenue,
-- plan-mix, and expansion questions. Active = not yet canceled.
CREATE OR REPLACE VIEW mrr_by_plan AS
SELECT
  s.plan,
  COUNT(*) AS accounts,
  SUM(s.seats) AS seats,
  CAST(SUM(s.mrr) AS DECIMAL(14,2)) AS mrr,
  CAST(SUM(s.mrr) / NULLIF(COUNT(*), 0) AS DECIMAL(10,2)) AS avg_mrr
FROM subscriptions s
WHERE s.canceled_at IS NULL
GROUP BY s.plan;
