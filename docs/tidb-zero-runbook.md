# TiDB Zero demo runbook

## 1. クラスタ申請/作成

1. TiDB Cloud コンソールで TiDB Zero（または互換の Starter/Essential）を作成/申請する。
2. 機能要件を確認する。
   - Vector Search: `VECTOR(3)` 型と `VEC_COSINE_DISTANCE()` を利用する。
   - Full-text Search: `FULLTEXT KEY` と `MATCH(...) AGAINST(...)` を利用する。FULLTEXT は TiDB Cloud Starter/Essential の一部 AWS リージョンでのみサポートされるため、作成時に対応リージョンを選ぶ。
3. Public endpoint を有効化し、Connect ダイアログから MySQL 接続情報を取得する。
4. 接続情報を `.env` に設定する。パスワードや秘密情報は commit しない。

## 2. データ import

```bash
npm install
npm run dry-run
npm run demo
```

`npm run demo` は以下を実行する。

1. `tidb_zero_documents` テーブルを作成する。
2. `src/fixture.mjs` の 4 件の文書と 3 次元 embedding を upsert する。
3. 件数、index、`SHOW CREATE TABLE` を取得する。

## 3. Vector Search テスト

スクリプトは以下のクエリで cosine distance の昇順 top-k を返す。

```sql
SELECT id, title, category, VEC_COSINE_DISTANCE(embedding, '[0.9,0.08,0.02]') AS distance
FROM tidb_zero_documents
ORDER BY distance ASC
LIMIT 3;
```

期待: `TiDB Vector Search` が最上位になる。

## 4. Full-text Search テスト

スクリプトは以下のクエリで keyword score の降順 top-k を返す。

```sql
SELECT id, title, category,
       MATCH(title, body) AGAINST ('product documentation' IN NATURAL LANGUAGE MODE) AS score
FROM tidb_zero_documents
WHERE MATCH(title, body) AGAINST ('product documentation' IN NATURAL LANGUAGE MODE)
ORDER BY score DESC, id ASC
LIMIT 3;
```

期待: `Full-text search for product docs` が結果に含まれる。

## 5. ブロッカー

この作業環境には TiDB Zero アカウント、クラスタ作成権限、接続先ホスト、ユーザー名、パスワードがないため、実クラスタ作成と live query は実行できない。レビュー時は `.env.example` をもとに接続情報を設定して `npm run demo` を実行する。
