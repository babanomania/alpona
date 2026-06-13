-- Weekly feature usage by region — the first stop for engagement,
-- adoption, and product-usage questions.
CREATE OR REPLACE VIEW feature_adoption AS
SELECT
  date_trunc('week', u.event_date) AS week,
  u.feature,
  a.region,
  COUNT(DISTINCT u.account_id) AS active_accounts,
  SUM(u.events) AS events
FROM usage_events u
JOIN accounts a ON a.id = u.account_id
GROUP BY date_trunc('week', u.event_date), u.feature, a.region;
