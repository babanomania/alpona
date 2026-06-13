-- On-hand stock vs reorder point per SKU × warehouse, with days of
-- cover derived from trailing weekly demand.
CREATE OR REPLACE VIEW stock_risk AS
SELECT
  p.sku,
  p.name AS product,
  p.category,
  w.code AS warehouse,
  w.region,
  i.on_hand,
  p.reorder_point,
  (i.on_hand < p.reorder_point) AS below_reorder,
  CAST(i.on_hand * 7.0 / NULLIF(d.avg_weekly_units, 0) AS DECIMAL(10,1)) AS days_of_cover
FROM inventory i
JOIN products p ON p.id = i.product_id
JOIN warehouses w ON w.id = i.warehouse_id
LEFT JOIN (
  SELECT product_id, warehouse_id, AVG(units) AS avg_weekly_units
  FROM demand_history
  GROUP BY product_id, warehouse_id
) d ON d.product_id = i.product_id AND d.warehouse_id = i.warehouse_id;
