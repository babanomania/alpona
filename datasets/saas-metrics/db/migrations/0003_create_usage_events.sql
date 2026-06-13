CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  event_date DATE NOT NULL,
  feature VARCHAR(20) NOT NULL,
  events INTEGER NOT NULL
);
