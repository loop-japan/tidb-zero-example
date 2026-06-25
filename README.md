# TiDB Zero example: data import + vector search + full-text search

TiDB Zero / TiDB Cloud Starter 互換の MySQL 接続先に、少量のサンプル文書を import し、TiDB の `VECTOR` 型によるベクトル検索と `FULLTEXT` index による全文検索を確認する最小デモです。

> このリポジトリは認証情報を含みません。実クラスタでの実行には、TiDB Zero または TiDB Cloud Starter/Essential の接続情報を `.env` に設定してください。

## 構成

- `src/import-and-test.ts`: テーブル作成、データ投入、ベクトル検索、全文検索を一括実行する TypeScript/Node.js CLI
- `src/tidb-zero-env.ts`: TiDB Zero API レスポンスから `.env` を生成する TypeScript/Node.js CLI
- `src/web-server.ts`: Web UI とステップ実行 API を提供するローカルサーバ
- `src/tidb-demo.ts`: CLI と Web UI で共有する TiDB 接続/検索ロジック
- `public/`: ブラウザからステップごとに TiDB Zero テストを実行するグラフィカル UI
- `src/fixture.ts`: デモ用データと検索クエリ
- `sql/schema.sql`: 手動確認用 DDL
- `sql/sample-queries.sql`: 手動確認用検索 SQL
- `docs/tidb-zero-runbook.md`: クラスタ申請/作成からレビューまでの手順
- `.env.example`: 必要な環境変数テンプレート

## TiDB Zero クラスタの準備

1. TiDB Cloud にログインし、TiDB Zero（または互換の TiDB Cloud Starter/Essential）クラスタを作成/申請します。
2. Vector Search と FULLTEXT を検証したい場合は、対象リージョンが両機能をサポートしていることを確認します。TiDB 公式ドキュメントでは、Vector Search は Starter/Essential 等で利用可能、FULLTEXT index は一部 AWS リージョンの Starter/Essential でのみ利用可能とされています。
3. クラスタ画面の **Connect** から Public endpoint / MySQL CLI の接続情報を取得し、ユーザー名（例: `<prefix>.root`）、ホスト、ポート、パスワード、DB 名を控えます。


## TiDB Zero API レスポンスから `.env` を生成

TiDB Zero の quickstart/API は `POST https://zero.tidbapi.com/v1beta1/instances` で一時インスタンスを作成し、レスポンスの `instance.connection` / `instance.connectionString` に接続情報を返します。このリポジトリでは、bash + `jq` ではなく pnpm script で `.env` を生成できます。

```bash
pnpm install

# 新しい TiDB Zero インスタンスを作成し、tidb-zero.json と .env を生成
pnpm tidb-zero:env -- --create

# 既存の API レスポンスファイルを .env に変換（live API は呼ばない）
pnpm tidb-zero:env -- --from tidb-zero.json
```

生成されるキーは `.env.example` と同じ `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE`, `TIDB_SSL`, `TIDB_RESET` です。`.env` と `tidb-zero.json` にはパスワードが含まれるため `.gitignore` 済みです。出力先が既に存在する場合は上書きしません。再生成したい場合だけ `--force` を付けてください。

よく使うオプション:

```bash
# タグを指定して作成
pnpm tidb-zero:env -- --create --tag my-demo

# DB 名や SSL / reset フラグを明示
pnpm tidb-zero:env -- --from tidb-zero.json --database test --ssl true --reset false

# 秘密情報を書き込まず、redacted preview だけ表示
pnpm tidb-zero:env -- --from tidb-zero.json --dry-run
```

`TIDB_ZERO_API_KEY` が設定されている場合は Bearer token として API リクエストに付与します。通常の quickstart と同じく不要な場合は未設定のままで構いません。

## CLI での実行方法

```bash
cp .env.example .env
# .env を編集して TIDB_HOST / TIDB_USER / TIDB_PASSWORD / TIDB_DATABASE を設定
pnpm install
pnpm dry-run
pnpm demo
```

既存テーブルを作り直したい場合のみ、`.env` に `TIDB_RESET=true` を設定してください。

## Web UI でステップ実行する方法

```bash
pnpm install
pnpm web
# ブラウザで http://127.0.0.1:4173 を開く
```

Web UI では以下を 1 ステップずつ実行できます。

1. TiDB 接続情報をフォームに入力（`.env` がある場合は host / port / user / database / SSL の初期値として読み込み）
2. Connect / health check: `SELECT VERSION(), DATABASE()` で接続確認
3. Initialize + import: demo テーブル作成と fixture upsert
4. Vector Search: `VEC_COSINE_DISTANCE` 検索を任意の query vector / Top K で実行
5. Full-text Search: `MATCH(title, body) AGAINST` 検索を任意キーワードで実行
6. Inspect table: index と `SHOW CREATE TABLE` の確認

認証情報はリポジトリに含めません。Web UI のパスワード欄はファイル保存されず、各 API 呼び出しでローカルサーバに送信されるだけです。`.env` からもパスワードは UI 初期値として返しません。

## 期待される確認内容

`pnpm demo` は JSON を出力します。以下を確認してください。

- `tableRowCount` が `importedRows` 以上であること
- `vectorSearch.rows[0].title` が `TiDB Vector Search` であること
- `fullTextSearch.rows` に `Full-text search for product docs` が含まれること
- `indexes` に `ft_title_body` が含まれること

## ローカルで検証できること / できないこと

- ローカルでは `pnpm test` と `pnpm dry-run` により、fixture、SQL 生成、Web API 入力検証の整合性を検証できます。
- TypeScript の型チェックとビルドは `pnpm typecheck` / `pnpm build` で実行できます。ビルド成果物は `dist/` に出力されます。
- TiDB Zero の申請、クラスタ作成、実データ import、実際の vector / full-text search 実行は、TiDB Zero アカウントとクラスタ接続情報が必要です。
