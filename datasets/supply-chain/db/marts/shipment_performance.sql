-- One row per shipment with everything a delay question needs:
-- late-vs-on-time, delay magnitude, carrier, lane, value at risk.
CREATE OR REPLACE VIEW shipment_performance AS
SELECT
  s.id AS shipment_id,
  s.carrier,
  s.status,
  s.dispatched_at AS dispatched,
  s.promised_at AS promised,
  s.delivered_at AS delivered,
  w.code AS warehouse,
  w.region,
  sup.name AS supplier,
  p.category,
  CAST(s.delivered_at - s.promised_at AS INTEGER) AS delay_days,
  (s.delivered_at IS NOT NULL AND s.delivered_at > s.promised_at) AS is_late,
  CAST(o.quantity * o.unit_price AS FLOAT8) AS order_value
FROM shipments s
JOIN purchase_orders o ON o.id = s.order_id
JOIN products p ON p.id = o.product_id
JOIN suppliers sup ON sup.id = o.supplier_id
JOIN warehouses w ON w.id = s.warehouse_id;
