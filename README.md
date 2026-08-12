# NAGA局面ドリル

NAGAの解析結果から何切る問題を作り、URLで共有できる麻雀学習アプリです。

## 利用者ごとのデータ

- 問題集は `public` または推測困難な `unlisted` URLで共有できます。
- URLを知る人はログインなしでも閲覧・回答できます。
- 未ログイン時の回答履歴は、その端末の `localStorage` のみに保存されます。
- Discordログイン後の回答履歴はSupabaseへ同期され、自分だけが参照できます。
- 講師は、同じワークスペース／クラスで許可された生徒の集計だけを参照できます。
- 生徒同士の回答履歴は参照できません。
- 共有問題集へのコメント投稿はDiscordログイン必須です。閲覧可否は問題集の公開範囲に従います。

## 共有問題集の権限

- Discordログイン済みの利用者は、投稿を許可した共有問題集へ問題を追加できます。
- 問題の作成者は自分の問題を編集し、共有ゴミ箱へ移動できます。操作前には「全利用者に影響する」確認を表示します。
- 他人の問題は直接編集・削除できず、削除提案を送信します。
- 問題集の所有者は問題管理と削除提案の承認・却下を行えます。
- 復元不能な完全削除は、Supabase Authの `app_metadata.is_admin = true` が設定された全体管理者だけが実行できます。利用者がブラウザからこの値を書き換えることはできません。
- 問題の作成者・最終更新者と変更履歴を保存します。
- 全体統計は最初の回答だけを集計し、回答後かつ5人以上集まった問題に限って匿名表示します。個人名や個別回答は公開しません。

## 問題生成

- 局面URL: `tw`・`ts`・`tv`で指定された1局面を問題化します。
- 半荘URL: 対象プレイヤーを選び、候補を一括抽出します。
- 標準条件: いずれかのNAGAモデルで、実際の選択率が5%以下の判断。
- カスタム条件: 閾値、打牌／副露／リーチ、いずれか／全モデル、最大抽出数を変更できます。

## ローカル起動

Node.js 22以上を使用します。

```powershell
npm install
npm start
```

Supabase未設定でも既存のローカル機能は動作します。Supabase連携を試す場合は、ブラウザ公開用のURLとpublishable keyだけを `public/runtime-config.js` に設定します。secret keyやservice-role keyは絶対に置かないでください。

## Supabaseセットアップ

1. 専用Supabaseプロジェクトを作成します。
2. Discord Developer PortalでOAuth2のredirect URLを確認します。
3. Supabase Dashboardの Authentication > Providers > Discord を有効にします。
4. Supabase CLIでプロジェクトへリンクします。
5. DBマイグレーションとEdge Functionを配備します。

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase functions deploy naga-report
```

### NAGA局面の自動撮影

局面URLから盤面画像を自動取得するには、Supabase Edge Function `naga-capture` とBrowserlessを使用します。Browserlessのトークンは公開クライアントへ置かず、SupabaseのFunction Secretとして設定してください。

```powershell
npx supabase secrets set BROWSERLESS_API_TOKEN=<browserless-token>
npx supabase secrets set BROWSERLESS_ENDPOINT=https://production-sfo.browserless.io
npx supabase functions deploy naga-capture
```

自動撮影に失敗した場合は、問題生成画面から従来どおり手動画像へ切り替えられます。

DB定義は `supabase/migrations/20260803165942_learning_platform_core.sql`、NAGA取得用の認証必須プロキシは `supabase/functions/naga-report/` にあります。

全体管理者はDiscordログイン後、SupabaseのAuth管理機能から対象ユーザーの `app_metadata` に `{ "is_admin": true }` を設定します。反映後は一度ログアウトし、再ログインして新しい認証情報を取得します。

アップロード画像用の `question-assets` バケットは非公開です。ブラウザへsecret keyを渡さず、将来の画像共有は期限付き署名URLで行います。

## 既存228問の移行

初回ログインで作成された管理者ユーザーIDを指定し、サーバー専用secret keyをローカル環境変数に入れて実行します。secret keyはブラウザ、GitHub Variables、コミットへ含めません。

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SECRET_KEY = "sb_secret_..."
$env:NAGA_OWNER_USER_ID = "<管理者user id>"
npm run import:questions
```

完了時に `/?collection=<share_slug>` が表示されます。このURLを知る生徒は閲覧・回答でき、Discordログイン後はコメントも投稿できます。

## GitHub Pages

`.github/workflows/pages.yml` が `public/` を配備します。GitHubリポジトリの Settings > Secrets and variables > Actions > Variables に次を登録してください。

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

その後、Settings > Pages > Source を `GitHub Actions` にします。ワークフローは公開時に `public/runtime-config.js` を生成し、secret keyが混入しないよう検査します。

## 検証

```powershell
npm run test:drill
npm test
npm run lint
npm audit --omit=dev
```
