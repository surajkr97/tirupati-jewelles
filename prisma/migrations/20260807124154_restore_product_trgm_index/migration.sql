-- Restore the trigram index that a Prisma migration dropped (Phase 9, DEBT-023).
--
-- `20260805144145_product_search_index` created `Product_name_trgm_idx` in hand-written SQL
-- for §6.4's prefix and typo-tolerant matching. It was not declared in `schema.prisma`, so
-- the NEXT migration — `20260805200149_shop_settings` — saw an index in the database that
-- the schema did not describe and dropped it as drift. Nothing failed: at 25 products a
-- sequential scan is the correct plan, so the loss was invisible for two phases.
--
-- The index is now declared in `schema.prisma` (`@@index([name(ops: raw("gin_trgm_ops"))],
-- type: Gin)`), so the diff that dropped it cannot be generated again, and
-- `lib/catalog/search.indexes.test.ts` asserts both search indexes exist in the database.
--
-- The expression index `Product_search_idx` survived only because Prisma's diff cannot see
-- expression indexes at all — that is luck, not protection, which the test also covers.

-- CreateIndex
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
