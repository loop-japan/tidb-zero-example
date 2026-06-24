-- Vector search: smaller cosine distance means a closer match.
SELECT
  id,
  title,
  category,
  VEC_COSINE_DISTANCE(embedding, '[0.9,0.08,0.02]') AS distance
FROM tidb_zero_documents
ORDER BY distance ASC
LIMIT 3;

-- Full-text search: requires TiDB Cloud Starter/Essential in a region that supports FULLTEXT indexes.
SELECT
  id,
  title,
  category,
  MATCH(title, body) AGAINST ('product documentation' IN NATURAL LANGUAGE MODE) AS score
FROM tidb_zero_documents
WHERE MATCH(title, body) AGAINST ('product documentation' IN NATURAL LANGUAGE MODE)
ORDER BY score DESC, id ASC
LIMIT 3;
