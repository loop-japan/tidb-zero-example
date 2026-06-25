import { TABLE_NAME } from './fixture.js';

export const createTableSql = `
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
  id INT NOT NULL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  search_text TEXT NOT NULL,
  category VARCHAR(64) NOT NULL,
  embedding VECTOR(3) NOT NULL,
  FULLTEXT KEY ft_search_text (search_text)
);
`.trim();

export const dropTableSql = `DROP TABLE IF EXISTS ${TABLE_NAME};`;

export const upsertSql = `
INSERT INTO ${TABLE_NAME} (id, title, body, search_text, category, embedding)
VALUES (?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  body = VALUES(body),
  search_text = VALUES(search_text),
  category = VALUES(category),
  embedding = VALUES(embedding);
`.trim();

export const rowCountSql = `SELECT COUNT(*) AS row_count FROM ${TABLE_NAME};`;

export const vectorSearchSql = `
SELECT
  id,
  title,
  category,
  VEC_COSINE_DISTANCE(embedding, ?) AS distance
FROM ${TABLE_NAME}
ORDER BY distance ASC
LIMIT ?;
`.trim();

export const fullTextSearchSql = `
SELECT
  id,
  title,
  category,
  MATCH(search_text) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
FROM ${TABLE_NAME}
WHERE MATCH(search_text) AGAINST (? IN NATURAL LANGUAGE MODE)
ORDER BY score DESC, id ASC
LIMIT ?;
`.trim();

export const showIndexesSql = `SHOW INDEX FROM ${TABLE_NAME};`;
export const showCreateTableSql = `SHOW CREATE TABLE ${TABLE_NAME};`;
