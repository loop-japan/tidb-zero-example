# TiDB Zero example: data import + vector search + full-text search

TiDB Zero / TiDB Cloud Starter 互換の MySQL 接続先に、少量のサンプル文書を import し、TiDB の `VECTOR` 型によるベクトル検索と `FULLTEXT` index による全文検索を確認する最小デモです。

> このリポジトリは認証情報を含みません。実クラスタでの実行には、TiDB Zero または TiDB Cloud Starter/Essential の接続情報を `.env` に設定してください。

## 構成

- `src/import-and-test.ts`: テーブル作成、データ投入、ベクトル検索、全文検索を実行する TypeScript/Node.js スクリプト
- `src/fixture.ts`: デモ用データと検索クエリ
- `sql/schema.sql`: 手動確認用 DDL
- `sql/sample-queries.sql`: 手動確認用検索 SQL
- `docs/tidb-zero-runbook.md`: クラスタ申請/作成からレビューまでの手順
- `.env.example`: 必要な環境変数テンプレート

## TiDB Zero クラスタの準備

1. TiDB Cloud にログインし、TiDB Zero（または互換の TiDB Cloud Starter/Essential）クラスタを作成/申請します。
2. Vector Search と FULLTEXT を検証したい場合は、対象リージョンが両機能をサポートしていることを確認します。TiDB 公式ドキュメントでは、Vector Search は Starter/Essential 等で利用可能、FULLTEXT index は一部 AWS リージョンの Starter/Essential でのみ利用可能とされています。
3. クラスタ画面の **Connect** から Public endpoint / MySQL CLI の接続情報を取得し、ユーザー名（例: `<prefix>.root`）、ホスト、ポート、パスワード、DB 名を控えます。

## 実行方法

```bash
cp .env.example .env
# .env を編集して TIDB_HOST / TIDB_USER / TIDB_PASSWORD / TIDB_DATABASE を設定
pnpm install
pnpm dry-run
pnpm demo
```

既存テーブルを作り直したい場合のみ、`.env` に `TIDB_RESET=true` を設定してください。

## 期待される確認内容

`pnpm demo` は JSON を出力します。以下を確認してください。

- `tableRowCount` が `importedRows` 以上であること
- `vectorSearch.rows[0].title` が `TiDB Vector Search` であること
- `fullTextSearch.rows` に `Full-text search for product docs` が含まれること
- `indexes` に `ft_title_body` が含まれること

## ローカルで検証できること / できないこと

- ローカルでは `pnpm test` と `pnpm dry-run` により、fixture と SQL 生成の整合性を検証できます。
- TypeScript の型チェックとビルドは `pnpm typecheck` / `pnpm build` で実行できます。ビルド成果物は `dist/` に出力されます。
- TiDB Zero の申請、クラスタ作成、実データ import、実際の vector / full-text search 実行は、TiDB Zero アカウントとクラスタ接続情報が必要です。
