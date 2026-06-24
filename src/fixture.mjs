export const TABLE_NAME = 'tidb_zero_documents';

// Tiny deterministic fixture: 3-dimensional embeddings keep the demo readable and
// match PingCAP's SQL quickstart style. Replace with production embeddings later.
export const DOCUMENTS = [
  {
    id: 1,
    title: 'TiDB Vector Search',
    body: 'TiDB stores embeddings in a VECTOR column and ranks similar documents with cosine distance.',
    category: 'vector',
    embedding: [0.92, 0.07, 0.01]
  },
  {
    id: 2,
    title: 'Full-text search for product docs',
    body: 'A FULLTEXT index lets applications find product documentation by natural language keywords.',
    category: 'fulltext',
    embedding: [0.08, 0.88, 0.04]
  },
  {
    id: 3,
    title: 'Hybrid retrieval workflow',
    body: 'Hybrid search combines vector similarity with keyword search for retrieval augmented generation.',
    category: 'hybrid',
    embedding: [0.52, 0.40, 0.08]
  },
  {
    id: 4,
    title: 'Operational checklist',
    body: 'Import data, verify row counts, run search queries, and record cluster settings for reviewers.',
    category: 'ops',
    embedding: [0.05, 0.10, 0.85]
  }
];

export const VECTOR_QUERY = [0.90, 0.08, 0.02];
export const FULLTEXT_QUERY = 'product documentation';

export function toVectorLiteral(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('embedding must be a non-empty numeric array');
  }
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`embedding contains a non-finite number: ${value}`);
    }
  }
  return `[${values.join(',')}]`;
}
