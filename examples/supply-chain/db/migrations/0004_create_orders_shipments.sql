CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price FLOAT8 NOT NULL,
  ordered_at DATE NOT NULL,
  status VARCHAR(16) NOT NULL -- pending | confirmed | shipped | delivered | cancelled
);

CREATE TABLE shipments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  carrier VARCHAR(24) NOT NULL,
  dispatched_at DATE NOT NULL,
  promised_at DATE NOT NULL,
  delivered_at DATE, -- NULL while in transit
  status VARCHAR(16) NOT NULL -- in_transit | delivered
);
