-- Full-text search over the catalogue (Phase 6 §6.4).
--
-- Hand-written because these are Postgres expression indexes, which Prisma's schema
-- language cannot express. This is not schema drift — `migrate diff` sees no model change,
-- and the indexes are invisible to the client. Only `lib/catalog/search.ts` uses them,
-- through a parameterised `$queryRaw`.
--
-- Weighting matters more than it looks. A search for "gold" should rank a product actually
-- named "Gold Temple Necklace" above one whose description merely mentions gold in passing,
-- so the name gets weight A and the description weight B. Category is joined at query time
-- rather than denormalised into the index, because a category rename would otherwise leave
-- every one of its products silently mis-indexed until each was touched.
--
-- 'english' is the right dictionary despite the Indian product vocabulary: it supplies
-- stemming and stop-words for the connecting words ("with", "for", "and"), while the domain
-- nouns — jhumka, kada, mangalsutra — are in no dictionary and are indexed as-is, which is
-- exactly what we want.

CREATE INDEX "Product_search_idx" ON "Product"
USING GIN (
  (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
  )
);

-- Trigram index for prefix and typo-tolerant matching, which full-text alone does not do:
-- `to_tsvector` will not match "neckl" against "necklace", and a shopper typing into a
-- search box is mid-word on every keystroke.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
