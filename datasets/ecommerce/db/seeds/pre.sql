-- Reverse dependency order so re-seeding never trips a foreign key.
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM products;
DELETE FROM customers;
