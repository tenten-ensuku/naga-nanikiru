# Discord転送 V242

対象は `cloudflare/discord-targets-v242.mjs` に固定したピエール・垣崎にまだけ。
問題とコメントは D1、画像は非公開 R2 に保存する。旧 Supabase Bot は起動しない。
既存問題はコメントのみ差分更新し、ID・番号・手牌・履歴を維持する。
NAGA局面が変更された場合、200問到達時、権限・容量エラーは保留して確認を求める。

## 実行

`node scripts/run-discord-sync-v242.mjs run`

- 既存 `../../outputs/naga-thread-bot/` の Discordライブラリ、読み取り/コメント規則、`.env` の **DISCORD_BOT_TOKEN だけ**を再利用。
- 新しい `.env.minkiru-bot` と Worker secret `DISCORD_SYNC_TOKEN` は同一のランダムな機械用トークン。ソースやログに含めない。
- Worker `DISCORD_SYNC_ENABLED=false` で転送だけ停止できる。通常の学習・回答保存には影響しない。
- 本PCの常駐Nodeプロセスで実行。PC停止・スリープ中は転送できない。Windowsログオン時に再開する。
- Discord Gatewayで新着/編集を検知し15秒まとめる。補助確認は15分ごとのスレッドメタデータのみ。
- 初回確認も各チャンネル最新50スレッドに限定。既存問題は直近14日活動のあるもののみ再確認し、全件の本文再取得や再生成はしない。
- 1スレッド上限1,000投稿、コメント200件。画像上限5MB、1回の問題保存は既存APIの画像8点上限を維持。超える場合は保留する。
- 1件ずつ65秒以上あけて処理。1日100変更・既存の生成/画像保存安全枠を共有し、上限で保留する。
- 402/権限/容量エラーは再試行しない。日次の生成上限だけ翌日9:05 JST以降へ延期する。一時エラーは最大3回。
- `output/discord-bot-v242/state.json` に未処理キュー・結果を保持し、原文スナップショットと転送画像の独立バックアップも同ディレクトリへ保存する。
- `private_discord_bot_status` は1時間に1回の状態記録であり、稼働開始の証明には実際の `private_discord_sync` と問題表示も確認する。

## 少数確認

`node scripts/run-discord-sync-v242.mjs dry nima <thread-id>` はDiscord読み取りだけ。

`node scripts/run-discord-sync-v242.mjs one pierre <thread-id>` は指定1スレッドを実際に同期する。

保留解除は原因を調べ、現在の容量・権限を確認してから、該当キューだけ操作する。旧Botの回路遮断状態は解除しない。
将来PC稼働に依存しない常設実行へ移す場合も、同じ限定APIと安全枠を用いる。
