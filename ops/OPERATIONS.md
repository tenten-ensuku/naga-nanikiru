# アプリ別・容量管理 v1 運用手順

## 導入範囲

管理 Worker: `ensuku-ops.naga-study.workers.dev`。GitHub Pagesや公開画像WorkerをAccess保護対象へ追加しない。管理バケット `ensuku-ops-data` は非公開、Standard。Sitesと契約プランは変更しない。

管理画面の値は本番データそのものではなく集計スナップショット。画像本体や問題本文の全件ダウンロードは行わない。DBは公開スキーマの明示分類と物理サイズ、画像はオブジェクトメタデータを使う。未分類テーブルとシステム残差は共通扱い。インベントリ内部では現在参照パスだけを取得・照合し、画面・保存用HTML・集計JSONへ出力しない。

## 本人の設定が必要な項目

1. Cloudflare Zero Trust Freeの初期契約を本人が完了する（Standardは選ばない）。
2. Access Self-hosted Applicationを**管理Workerのホスト名だけ**に作成する。Allow条件は本人のメール1件、Everyone/Bypass/Publicを設定しない。メールOTP等のログイン手段を有効にする。
3. 発行されたTeam domainとApplication AUDを `wrangler.ops.jsonc` の `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` に設定する。
4. このCloudflareアカウントだけに限定した `Account Analytics: Read` APIトークンを本人のローカル `.env.ops` の `CF_ANALYTICS_TOKEN` に保存する。チャット・HTML・コミットへ貼らない。
5. `node scripts/ops-admin.mjs install-optional-secrets` でWorker Secretsへ登録する。既存秘密は上書きしない。CLI OAuthトークンをデプロイする代用は禁止。

新規サーバー間 `OPS_MONITOR_TOKEN` は256bit乱数でWorker Secretに保存済み。Supabase Edge Functionには一方向SHA-256検証値だけを配置する。通常のユーザーJWTでは容量RPCを呼べない。検証値は秘密鍵ではない。鍵のローテーションは自動で行わず両側を同時更新する。

本人のメールとDiscord宛先IDも `OPS_OWNER_EMAIL` / `OPS_OWNER_DISCORD_ID` としてWorker Secretsへ保存する。公開リポジトリや管理HTMLに本人の連絡先を埋め込まない。

## 順序・確認

1. 全テストと匿名403を確認。設定前はAccess未完成でもWorker自身が全コンテンツを拒否する。R2オブジェクトを公開しない。
2. 本人でログインし、別メール・無認証・偽JWT・直リンクの拒否を確認。初回JSONの3グラフ合計と表を照合する。
3. Supabase Dashboardの**現在の期間**・通常Egress・Cached Egressを手動確認して登録する。任意でStorage期間平均も登録できる。丸め表示を換算した値は精密な実測bytesではない。期間平均は現在値グラフや物理容量の閾値に混ぜない。
4. `COLLECTOR_ENABLED=true` で15分cronを実行。DBは毎時、R2は初回と毎日03時JST、CF回数は15分。画面の開閉で集計を増やさない。
5. 初回R2インベントリが成功し、旧画像Workerの日次処理を置き換えられることを確認してから `wrangler.media.jsonc` の旧cronを外す。両方を日次で回さない。
6. `SEND_SETUP_DM=true` は初回1回だけ本人確認通知を送る。設定前の通常アラートは管理画面に保存し、`NOTIFICATIONS_ENABLED=false` ならDMしない。本運用でtrueへ切替。
7. `CONTROL_SYNC_ENABLED=true` は両DBへ**観測中=armed false**を反映する。24時間の実観測・96回の正常15分集計・権限/表示/安全テストを確認してから `ENFORCEMENT_READY=true` にする。日付だけでは有効にならない。
8. 有効後は90%/R2 8GB/24時間不明で重い追加処理のみを止める。値が下がっても自動解除しない。全項目が新鮮、通常75%未満/R2 7GB未満で本人が再開ボタンを使う。片方のDBへの反映に失敗したら再開成功とせず再び制限する。

画像アップロードの従来8GB予約予算は観測中も残る。新しい容量制限は認証・既存閲覧・練習・回答保存・文字コメントを止めない。NAGA関数とBotは容量を事前確認し、制限時の入力と未処理マニフェストを保持する。DBトリガーでも新規画像・問題追加を防ぐ。Botをこの管理機能の導入だけで稼働再開しない。

## データ保持と通信予算

- `recent/` の15分スナップショット:48時間。`daily/`:90日。30日分を画面に表示。
- 保持期限で削除するのは管理Worker自身の正規名スナップショットだけ。画像バケット、問題、回答、コメントへ削除操作しない。
- 管理用データもR2の全実容量と予約予算へ加算する。新しい画像バケット/アプリを追加した場合は、分類とバインディングを必ず更新する（現行はimages/opsの2バケット）。
- CFはUTC日/UTC暦月、Supabase Egressは登録された請求期間。API回数をEgress bytesの代わりにしない。
- 収集失敗は最終成功値を保持し、時刻と失敗回数を表示。2回連続失敗で通知、未確認24時間で新しい重い処理だけ停止する。
- 無停止も完全無課金も保証しない。R2の7/8GBは自主的安全線であり課金停止上限ではない。

## 個別ロールバック

1. **画面のみ**: `ACCESS_AUD` を空にしてデプロイすると全アクセスを拒否。既存アプリと収集はそのまま。
2. **通知のみ**: `NOTIFICATIONS_ENABLED=false`, `SEND_SETUP_DM=false`。集計と制限はそのまま。
3. **自動制限のみ**: `ENFORCEMENT_READY=false` をデプロイ。次tickで観測へ戻すため `CONTROL_SYNC_ENABLED=true` を維持し、両DBの `private.ops_capacity_control.armed=false` を確認する。緊急時は所有者の管理SQLで `select public.ops_set_capacity_control(false,false,'operator rollback',now());` を両DBで実行する。これは監視機能だけの明示的な管理操作で、通常の自動解除ではない。
4. **収集のみ**: 先に上記3を実施・確認し、その後 `COLLECTOR_ENABLED=false` とする。制限を有効にしたまま監視だけ止めると24時間後の安全停止が働く。R2の旧日次cronを戻す場合は新集計が停止済みであることを先に確認する。

## 検証・公開コマンド

`node --test tests/ops-*.test.mjs` / `npm.cmd run test:drill` / `npm.cmd run test:media` / `npm.cmd run test:offline` / `npm.cmd run build`。

`node scripts/ops-verify-live.mjs public` は少数の匿名アクセス拒否を確認。`snapshot` は本人のCLIから管理集計だけを読み、`outputs/ops-v1/capacity-current.html` にネットワーク不要の本人用コピーを生成する。

`node scripts/qa-ops.mjs` は新規のローカルブラウザと模擬APIのみ。全外部通信を拒否。`PLAYWRIGHT_MODULES` / `BROWSER_EXECUTABLE` はローカル検証環境に設定する。

管理Worker: `wrangler deploy --config wrangler.ops.jsonc`。アプリを変更・公開する場合のpush先は `github` remoteのmainのみ。Sites用originを使わない。個人用HTML・集計JSON・秘密・移行原本・サポート資料をGitHub Pagesのpublicへコピーしない。

## V231導入時のEdge Function差分

`naga-capture` v7 は既存v6に容量の事前確認だけを追加。`naga-report` v3も公開中v2を基準に同じ事前確認だけを追加した。リポジトリに以前から存在した未公開の `modelNames` フィルタ差分は今回の公開へ混ぜていない。そのため、今後 `naga-report` をリポジトリから全面デプロイする場合は、この既存差分も含まれることを先に確認する。容量管理以外の解析条件の変更を今回の動作確認済み範囲として扱わない。

## 削減・将来方針（実施は別途）

優先1: Supabaseの移行済み画像原本はR2実表示・独立原本・現在参照を再照合して、別途承認後のみ削除。優先2: 約104MBの変更監査ログは無変更更新抑制と非公開R2アーカイブを検討。回答履歴をまとめて削除しない。優先3: 旧画像/重複/埋め込みを候補化する。

問題本文のR2配信はPostgREST通信の削減、D1部分移行はSQL処理の分離に役立つ可能性があるが、認証・権限・整合性の設計が別途必要。D1も日次上限を超えると失敗する。今回D1や組織分割を実施しない。既存問題の端末オフライン対応は次段階。

根拠: [Storage期間平均](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)、[Workers上限](https://developers.cloudflare.com/workers/platform/limits/)、[R2料金](https://developers.cloudflare.com/r2/pricing/)、[R2制限](https://developers.cloudflare.com/r2/platform/limits/)、[D1上限](https://developers.cloudflare.com/d1/platform/limits/)、[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)。
