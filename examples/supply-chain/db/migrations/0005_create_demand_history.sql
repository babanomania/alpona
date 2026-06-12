CREATE TABLE demand_history (
  product_id INTEGER NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  week DATE NOT NULL, -- Monday of the ISO week
  units INTEGER NOT NULL,
  PRIMARY KEY (product_id, warehouse_id, week)
);
