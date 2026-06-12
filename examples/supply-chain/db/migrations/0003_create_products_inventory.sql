CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku VARCHAR(16) NOT NULL,
  name VARCHAR(80) NOT NULL,
  category VARCHAR(40) NOT NULL,
  unit_cost FLOAT8 NOT NULL,
  -- replenishment is triggered when on-hand stock falls below this
  reorder_point INTEGER NOT NULL
);

CREATE TABLE inventory (
  product_id INTEGER NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  on_hand INTEGER NOT NULL,
  PRIMARY KEY (product_id, warehouse_id)
);
