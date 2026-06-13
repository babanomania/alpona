CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  plan VARCHAR(16) NOT NULL,
  seats INTEGER NOT NULL,
  mrr DECIMAL(10,2) NOT NULL,
  started_at DATE NOT NULL,
  canceled_at DATE
);
