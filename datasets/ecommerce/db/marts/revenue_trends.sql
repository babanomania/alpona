-- Weekly revenue, orders, and units by sales channel — the first stop for
-- any trend, growth, or channel-mix question.
CREATE OR REPLACE VIEW revenue_trends AS
SELECT
  date_trunc('week', o.ordered_at) AS week,
  o.channel,
  COUNT(DISTINCT o.id) AS orders,
  SUM(oi.quantity) AS units,
  CAST(SUM(oi.quantity * oi.unit_price) AS DECIMAL(14,2)) AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'fulfilled'
GROUP BY date_trunc('week', o.ordered_at), o.channel;
