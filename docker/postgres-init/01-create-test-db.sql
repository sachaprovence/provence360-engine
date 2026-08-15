-- The base image's POSTGRES_DB env var only creates one database
-- (provence360_dev). The isolation test suite needs a second, separate one
-- so `pnpm test` never runs against — let alone truncates — dev data.
CREATE DATABASE provence360_test OWNER provence360;
