import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCUMENTS, VECTOR_QUERY, toVectorLiteral } from '../src/fixture.mjs';
import { createTableSql, fullTextSearchSql, vectorSearchSql } from '../src/sql.mjs';

function cosineDistance(a, b) {
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  const normA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  const normB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
  return 1 - dot / (normA * normB);
}

test('fixture embeddings are valid TiDB vector literals', () => {
  assert.equal(toVectorLiteral([1, 2, 3]), '[1,2,3]');
  for (const doc of DOCUMENTS) {
    assert.match(toVectorLiteral(doc.embedding), /^\[[0-9.,-]+\]$/);
    assert.equal(doc.embedding.length, 3);
  }
});

test('vector fixture ranks the vector document first', () => {
  const [first] = DOCUMENTS
    .map((doc) => ({ id: doc.id, distance: cosineDistance(doc.embedding, VECTOR_QUERY) }))
    .sort((a, b) => a.distance - b.distance);
  assert.equal(first.id, 1);
});

test('SQL contains TiDB vector and full-text constructs', () => {
  assert.match(createTableSql, /embedding VECTOR\(3\)/);
  assert.match(createTableSql, /FULLTEXT KEY ft_title_body/);
  assert.match(vectorSearchSql, /VEC_COSINE_DISTANCE/);
  assert.match(fullTextSearchSql, /MATCH\(title, body\) AGAINST/);
});
