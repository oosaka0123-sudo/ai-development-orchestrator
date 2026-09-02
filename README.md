# AI Development Orchestrator

GPTをプロジェクトマネージャー、Claude Agentを実装担当、GitHubを唯一の共有作業場所としてつなぐMCPサーバーです。

## 現在できること

- `orchestrator_status`: 接続設定の確認（秘密値は表示しません）
- `plan_repository_task`: リポジトリを読み、変更せずに実装計画を作成
- `execute_repository_task`: 承認済みタスクを新規ブランチで実装し、コミット・push・PR作成
- 同一リポジトリへの同時書き込みを拒否
- `main`への直接push、PRの自動マージ、本番デプロイは行わない

## 全体構成

```text
ChatGPT Work / GPT
        │ MCP (HTTPS)
        ▼
AI Development Orchestrator
        ├── Claude Agent SDK（調査・編集・テスト）
        └── GitHub（branch・commit・pull request）
```

## 必要な設定

`.env.example`を参考に、ホスティングサービスの環境変数へ登録します。

- `ANTHROPIC_API_KEY`: Claude APIキー
- `GITHUB_TOKEN`: 対象リポジトリのContents/Pull requests書き込み権限
- `MCP_AUTH_TOKEN`: MCP接続用の長いランダム文字列
- `DEFAULT_OWNER`: 通常使うGitHub所有者（初期値 `oosaka0123-sudo`）

秘密情報は`.env`へ置き、GitHubへコミットしないでください。

## ローカル確認

```bash
npm install
npm run check
npm run dev
```

ヘルスチェックは `GET /health`、MCPエンドポイントは `POST /mcp` です。

## 安全設計

実装ツールは `confirmed=true` が必須です。作業は必ず一時ワークスペースと新規ブランチで行い、結果をPRとして返します。自動マージと自動デプロイは、CI・レビュー・ロールバック方針を整備する次段階で追加します。
