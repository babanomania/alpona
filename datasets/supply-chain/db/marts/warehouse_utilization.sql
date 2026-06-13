-- Units stored vs capacity per warehouse.
CREATE OR REPLACE VIEW warehouse_utilization AS
SELECT
  w.code AS warehouse,
  w.city,
  w.region,
  w.capacity_units,
  SUM(i.on_hand) AS units_stored,
  CAST(SUM(i.on_hand) * 100.0 / w.capacity_units AS DECIMAL(10,1)) AS utilization_pct
FROM warehouses w
LEFT JOIN inventory i ON i.warehouse_id = w.id
GROUP BY w.code, w.city, w.region, w.capacity_units;
