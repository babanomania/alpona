-- Revenue and order value per customer segment and country — the first
-- stop for segmentation, geography, and AOV questions.
CREATE OR REPLACE VIEW customer_segments AS
SELECT
  c.segment,
  c.country,
  COUNT(DISTINCT c.id) AS customers,
  COUNT(DISTINCT o.id) AS orders,
  CAST(SUM(oi.quantity * oi.unit_price) AS DECIMAL(14,2)) AS revenue,
  CAST(SUM(oi.quantity * oi.unit_price) / NULLIF(COUNT(DISTINCT o.id), 0) AS DECIMAL(10,2)) AS avg_order_value
FROM customers c
JOIN orders o ON o.customer_id = c.id AND o.status = 'fulfilled'
JOIN order_items oi ON oi.order_id = o.id
GROUP BY c.segment, c.country;
