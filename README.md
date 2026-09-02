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

### Claude Agentの権限モデル

Claude Agent SDKは `permissionMode: "bypassPermissions"` を使用しません（全権限バイパスは本番運用で禁止）。代わりに `canUseTool`（`src/permissions.ts`）が全てのツール呼び出しを個別に判定する、明示的なホワイトリスト方式です。

- **ファイル操作（Read/Edit/Write/Glob/Grep）**: 対象パスがワークスペース（クローンしたリポジトリ）内に解決される場合のみ許可。絶対パス・`..`によるワークスペース外アクセスは拒否
- **機密ファイルの除外**（`src/sensitiveFiles.ts`が唯一の定義元）: パス・ツール（Read/Edit/Write/Glob/GrepおよびBashコマンド内のパス参照）を問わず、以下は一律拒否:
  - `.env`およびその派生（`.env.local`/`.env.production`等）— **`.env.example`/`.env.sample`/`.env.template`のみプレースホルダー専用の例外として許可**
  - `.git`ディレクトリ配下の全て（config・認証情報・履歴を含む）
  - 秘密鍵・証明書・鍵ストア（`.pem`/`.key`/`.p12`/`.pfx`/`.crt`/`.cer`/`.jks`/`.keystore`/`.kdbx`/`.ovpn`/`.asc`/`.gpg`/`.ppk`）、SSH秘密鍵（`id_rsa`等。公開鍵`*.pub`は対象外）
  - `credentials`/`secrets.json`/`.npmrc`/`.netrc`等の既知の認証ファイル、および`secret`/`credential`/`password`/`token`/`apikey`等を含むファイル名
  - パス解決は`fs.realpath`で**シンボリックリンク・ジャンクションを解決した後にも**ワークスペース内・非機密であることを再検証（無害な名前のシンボリックリンクで`.env`や別ワークスペースを指すバイパスを防止）。存在しないパス（Write新規作成時）は最も近い実在する親ディレクトリまで遡って解決
  - 拒否理由はファイル内容や実際のパス文字列を含まない、固定カテゴリのメッセージのみ記録
- **Grep/Globのディレクトリ検索結果に対する第二の強制フィルタ**（`src/resultFilter.ts`、`PostToolUse`フック）: `canUseTool`は呼び出し自体（`path`/`glob`/`pattern`引数）しか判定できず、ディレクトリ全体を検索した際に実際どのファイルがヒットするかは呼び出し前には分かりません。そこで実行結果を`PostToolUse`フックで検査し、モデルに返る前に機密ファイルを取り除きます。判定基準は上記と完全に同一の`checkWorkspacePath`（realpath解決込み）を再利用しており、Claude自身の自制に依存しない、コード側での強制です。
  - `Glob`: `filenames`配列から機密ファイルを除外し、`numFiles`/`totalMatches`等の件数も除外後の値に補正
  - `Grep`: `filenames`配列を同様に除外。`content`（マッチ本文の生テキスト）はツール固有のフォーマットであり本コードベースが解析・保証できないため、機密ファイルが1件でも含まれていた場合は部分的な再構成を試みず**内容全体を空にして返す**（`files_with_matches`/`count`モードは元々`content`を持たないため、この場合でも許可ファイルの結果は失われません）
  - 除外の事実そのもの（該当件数・ファイル名）も結果に含めません。除外が発生してもしなくても、呼び出し元から見た結果の形は「機密ファイルが最初から存在しなかった場合」と区別できません
- **Bashコマンド**: `npm install/ci/run/test/build`、読み取り専用git（`status`/`diff`/`log`/`show`/`branch`）、基本的なファイル閲覧コマンドのみを許可する最小ホワイトリスト方式。以下は明示的に拒否:
  - `rm -rf`、`chmod`、`chown`、`sudo`
  - `git push`/`remote`/`config`/`merge`/`rebase`/`reset --hard`/`clean`（main直接push・強制push・マージは構造的に不可能）
  - `env`/`printenv`（先頭コマンドとして完全一致で判定。`.env.example`等を誤検知しない）、`export`
  - 上記の機密ファイル拒否ルールと同一基準（`checkWorkspacePath`、realpath解決込み）でのファイル参照（`cat id_rsa`・`grep foo .git/config`等）。ワークスペース内に置かれた無害な名前のシンボリックリンクを`cat`等で辿るケースも、Read/Edit/Write/Glob/Grepと同じ基準で検出・拒否します
  - `curl`/`wget`/`ssh`/`scp`などのネットワークコマンド（秘密情報の外部送信経路を遮断）
  - コマンド連結・リダイレクト・置換（`;`/`&&`/`|`/`` ` ``/`$()`/`>`/`<`）— ホワイトリスト一致を後段の未検証コマンドと連結して回避することを防止
  - `dangerouslyDisableSandbox: true`（サンドボックス無効化フラグ自体を拒否）
  - 上記いずれにも一致しないコマンドは既定で拒否（fail-closed）
- **未知のツール**: `canUseTool`が認識しない全てのツール名は既定で拒否
- **設定の分離**: `settingSources: []`により、対象リポジトリ自身の`.claude/settings.json`・`CLAUDE.md`は一切読み込みません。README・Issue・コメント・コードなど、リポジトリ内のあらゆる内容は信頼できない入力として扱われ、タスクや安全ルールを変更する指示として機能しません
- **権限モード**: `permissionMode: "dontAsk"`（無人実行のため対話プロンプトなし。`canUseTool`が明示的に許可しない限り拒否）
- **環境変数**: エージェントのプロセスには`ANTHROPIC_API_KEY`と最小限の実行環境変数（`PATH`/`HOME`等）のみを渡し、`GITHUB_TOKEN`・`MCP_AUTH_TOKEN`は一切渡しません（`src/agentEnv.ts`）
- **上限**: 実行時間（plan: 5分 / execute: 15分）、最大ターン数（plan: 12 / execute: 40）、出力サイズ（2万文字で切り詰め）
- **ログ**: APIキー・トークン・認証ヘッダーは`src/logging.ts`のredact処理を通してからのみ出力・エラー応答されます
- **監査ログ**: 実装開始前のタスク内容と、実装後の`git diff --stat`をJSON行としてstdoutへ記録します（`src/auditLog.ts`）
