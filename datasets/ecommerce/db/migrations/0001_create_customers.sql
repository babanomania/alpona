CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  country VARCHAR(20) NOT NULL,
  segment VARCHAR(16) NOT NULL,
  signup_date DATE NOT NULL
);
