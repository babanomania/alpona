CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  country VARCHAR(40) NOT NULL,
  -- 0-100 composite of on-time rate, defect rate, responsiveness
  reliability_score FLOAT8 NOT NULL
);
