-- Deterministic synthetic generators — same data every run, on both
-- postgres and duckdb. Arithmetic stands in for randomness so seeds are
-- reproducible and diffable; the LCG-style multipliers spread values.

-- ── Purchase orders: ~900 over the trailing 6 months ───────────────
DELETE FROM purchase_orders;
INSERT INTO purchase_orders (id, supplier_id, product_id, quantity, unit_price, ordered_at, status)
SELECT
  i,
  1 + ((i * 13) % 8),
  1 + ((i * 29) % 24),
  20 + ((i * 17) % 180),
  CAST(5 + ((i * 41) % 95) + ((i * 7) % 100) / 100.0 AS FLOAT8),
  DATE '2025-12-15' + CAST((i * 37) % 178 AS INTEGER),
  CASE
    WHEN (i * 37) % 178 > 170 THEN 'pending'
    WHEN (i * 37) % 178 > 160 THEN 'confirmed'
    WHEN (i % 31) = 0 THEN 'cancelled'
    ELSE 'delivered'
  END
FROM generate_series(1, 900) AS t(i);

-- ── Shipments: one per non-pending order ───────────────────────────
-- Carrier delay profiles are deliberately distinct so "delays by
-- carrier" questions have a real story to find.
DELETE FROM shipments;
INSERT INTO shipments (id, order_id, warehouse_id, carrier, dispatched_at, promised_at, delivered_at, status)
SELECT
  id,
  order_id,
  warehouse_id,
  carrier,
  dispatched_at,
  promised_at,
  CASE WHEN in_transit THEN NULL
       ELSE promised_at + CAST(delay_days AS INTEGER) END,
  CASE WHEN in_transit THEN 'in_transit' ELSE 'delivered' END
FROM (
  SELECT
    o.id AS id,
    o.id AS order_id,
    1 + ((o.id * 23) % 5) AS warehouse_id,
    CASE (o.id * 19) % 5
      WHEN 0 THEN 'Maersk'
      WHEN 1 THEN 'DHL'
      WHEN 2 THEN 'FedEx'
      WHEN 3 THEN 'DB Schenker'
      ELSE 'Nippon Express'
    END AS carrier,
    o.ordered_at + CAST(1 + ((o.id * 11) % 4) AS INTEGER) AS dispatched_at,
    o.ordered_at + CAST(1 + ((o.id * 11) % 4) + 4 + ((o.id * 3) % 5) AS INTEGER) AS promised_at,
    CASE (o.id * 19) % 5
      WHEN 0 THEN ((o.id * 7) % 9) - 4    -- Maersk: -4..+4, on time on average
      WHEN 1 THEN ((o.id * 7) % 5) - 3    -- DHL: -3..+1, usually early
      WHEN 2 THEN ((o.id * 7) % 7) - 2    -- FedEx: -2..+4
      WHEN 3 THEN ((o.id * 7) % 12) - 2   -- DB Schenker: -2..+9, chronically late
      ELSE ((o.id * 7) % 6) - 2           -- Nippon Express: -2..+3
    END AS delay_days,
    (o.ordered_at > DATE '2026-05-28') AS in_transit
  FROM purchase_orders o
  WHERE o.status NOT IN ('pending', 'cancelled')
) s;

-- ── Inventory: every product in every warehouse ─────────────────────
-- Roughly a fifth of positions sit below their reorder point.
DELETE FROM inventory;
INSERT INTO inventory (product_id, warehouse_id, on_hand)
SELECT
  p.id,
  w.id,
  CASE
    WHEN (p.id * 7 + w.id * 13) % 5 = 0
      THEN CAST(p.reorder_point * ((p.id * 11 + w.id * 3) % 80) / 100.0 AS INTEGER)
    ELSE p.reorder_point + ((p.id * 31 + w.id * 17) % (p.reorder_point * 2 + 10))
  END
FROM products p, warehouses w;

-- ── Demand history: 24 ISO weeks per product × warehouse ───────────
DELETE FROM demand_history;
INSERT INTO demand_history (product_id, warehouse_id, week, units)
SELECT
  p.id,
  w.id,
  DATE '2026-01-05' + CAST(t.wk * 7 AS INTEGER),
  GREATEST(
    0,
    CAST(p.reorder_point / 4 AS INTEGER)
      + ((p.id * 5 + w.id * 9 + t.wk * 3) % (1 + p.reorder_point / 3))
      - CAST(p.reorder_point / 8 AS INTEGER)
  )
FROM products p, warehouses w, generate_series(0, 23) AS t(wk);
