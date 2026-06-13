-- Clears generated tables before the CSV loads replace master data —
-- reverse dependency order, so re-seeding never trips a foreign key.
DELETE FROM demand_history;
DELETE FROM shipments;
DELETE FROM purchase_orders;
DELETE FROM inventory;
