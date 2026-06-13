-- One row per product with sales and margin — the first stop for
-- best-seller, category, and profitability questions.
CREATE OR REPLACE VIEW product_performance AS
SELECT
  p.name AS product,
  p.category,
  p.price,
  SUM(oi.quantity) AS units_sold,
  CAST(SUM(oi.quantity * oi.unit_price) AS DECIMAL(14,2)) AS revenue,
  CAST(SUM(oi.quantity * (oi.unit_price - p.cost)) AS DECIMAL(14,2)) AS margin
FROM products p
JOIN order_items oi ON oi.product_id = p.id
JOIN orders o ON o.id = oi.order_id AND o.status = 'fulfilled'
GROUP BY p.name, p.category, p.price;
