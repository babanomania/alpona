-- Deterministic synthetic generators — identical data every run, on both
-- postgres and duckdb. Arithmetic stands in for randomness so seeds are
-- reproducible and diffable.

-- ── Customers: 500, four segments across six countries ─────────────
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM products;
DELETE FROM customers;

INSERT INTO customers (id, name, country, segment, signup_date)
SELECT
  i,
  'Customer ' || i,
  CASE (i * 7) % 6
    WHEN 0 THEN 'United States' WHEN 1 THEN 'United Kingdom' WHEN 2 THEN 'Germany'
    WHEN 3 THEN 'India' WHEN 4 THEN 'Brazil' ELSE 'Australia' END,
  CASE (i * 13) % 4
    WHEN 0 THEN 'consumer' WHEN 1 THEN 'pro' WHEN 2 THEN 'business' ELSE 'enterprise' END,
  DATE '2024-01-01' + CAST((i * 17) % 540 AS INTEGER)
FROM generate_series(1, 500) AS t(i);

-- ── Products: 80 across six categories, with a real margin spread ───
INSERT INTO products (id, sku, name, category, price, cost)
SELECT
  i,
  'SKU-' || (1000 + i),
  'Product ' || i,
  CASE (i * 11) % 6
    WHEN 0 THEN 'Apparel' WHEN 1 THEN 'Electronics' WHEN 2 THEN 'Home'
    WHEN 3 THEN 'Beauty' WHEN 4 THEN 'Sports' ELSE 'Toys' END,
  CAST(10 + ((i * 37) % 240) + ((i * 7) % 100) / 100.0 AS DECIMAL(10,2)),
  CAST(5 + ((i * 23) % 120) + ((i * 3) % 100) / 100.0 AS DECIMAL(10,2))
FROM generate_series(1, 80) AS t(i);

-- ── Orders: 6000 over the trailing year, channel + status mix ──────
INSERT INTO orders (id, customer_id, ordered_at, channel, status)
SELECT
  i,
  1 + ((i * 29) % 500),
  DATE '2025-06-13' - CAST((i * 19) % 365 AS INTEGER),
  CASE (i * 5) % 4
    WHEN 0 THEN 'web' WHEN 1 THEN 'mobile' WHEN 2 THEN 'marketplace' ELSE 'retail' END,
  CASE
    WHEN (i % 23) = 0 THEN 'cancelled'
    WHEN (i % 9) = 0 THEN 'returned'
    ELSE 'fulfilled' END
FROM generate_series(1, 6000) AS t(i);

-- ── Order items: ~13k lines, 1-3 per order ─────────────────────────
INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
SELECT
  i,
  1 + ((i * 7) % 6000),
  1 + ((i * 31) % 80),
  1 + ((i * 3) % 4),
  CAST(10 + ((i * 41) % 240) + ((i * 7) % 100) / 100.0 AS DECIMAL(10,2))
FROM generate_series(1, 13000) AS t(i);
