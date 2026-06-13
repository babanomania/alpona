CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  ordered_at DATE NOT NULL,
  channel VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL
);
