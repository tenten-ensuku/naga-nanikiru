import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

test("V227 pauses hidden tabs and elects one visible notification poller", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /const APP_VERSION = 227;/);
  assert.match(html, /COMMENT_NOTIFICATION_POLL_MS_V227 = 300000/);
  assert.match(html, /NOTIFICATION_LEADER_STORAGE_KEY_V227 = storageKey\("notification-poll-leader-v227"\)/);
  assert.match(html, /function claimNotificationLeaderV227\(\)/);
  assert.match(html, /notificationLeaderLocalFallbackV227 = true/);
  assert.match(html, /document\.visibilityState === "visible"/);
  assert.match(html, /stopNotificationPollingV227\(\{ releaseLeader: true \}\)/);
  assert.match(html, /window\.addEventListener\("pagehide"/);
  assert.match(html, /refreshSharedCommentNotificationsV65\(\{ background: true \}\)/);
});

test("V227 removes periodic question-index polling and refreshes it on demand", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.doesNotMatch(html, /questionPollTimerV66/);
  assert.doesNotMatch(html, /setInterval\([\s\S]{0,180}refreshSharedQuestionNotificationsV66/);
  assert.match(html, /function openCommentNotificationDialogV65\(\)[\s\S]*refreshSharedCommentNotificationsV65\(\)[\s\S]*refreshSharedQuestionNotificationsV66\(\)/);
  assert.match(html, /問題一覧は定期取得しない/);
});
