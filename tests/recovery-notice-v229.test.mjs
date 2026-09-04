import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const clientUrl = new URL("../client/supabase-sync.ts", import.meta.url);
const assetUrl = new URL("../public/assets/recovery-notice-v229.png", import.meta.url);

test("V229 exposes the recovery notice and keeps the normal auth gate reversible", async () => {
  const [html, css, client] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(clientUrl, "utf8"),
    access(assetUrl),
  ]);

  assert.match(html, /const APP_VERSION = 229;/);
  assert.match(html, /window\.NAGA_MAINTENANCE_MODE = true;/);
  assert.match(html, /class="recovery-notice" id="recoveryNotice"/);
  assert.match(html, /src="assets\/recovery-notice-v229\.png"/);
  assert.match(html, /2026年9月6日から順次復旧予定です/);
  assert.match(html, /class="auth-gate" id="authGate"[^>]* hidden>/);
  assert.match(html, /function applyRecoveryNoticeModeV229\(enabled\)/);
  assert.match(html, /const RECOVERY_NOTICE_MODE_V229 = window\.NAGA_MAINTENANCE_MODE === true/);
  assert.match(html, /if \(RECOVERY_NOTICE_MODE_V229\) \{[\s\S]*applyRecoveryNoticeModeV229\(true\);[\s\S]*return;/);
  assert.match(css, /\.recovery-notice \{[\s\S]*position: fixed;[\s\S]*inset: 0;[\s\S]*z-index: 1200;/);
  assert.match(css, /\.recovery-notice-image \{[\s\S]*max-width: 100%;[\s\S]*max-height:/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.recovery-notice-image \{[\s\S]*width: 100%;/);
  assert.match(client, /const maintenanceMode = window\.NAGA_MAINTENANCE_MODE === true/);
  assert.match(client, /!maintenanceMode &&/);
  assert.match(client, /if \(!client \|\| maintenanceMode\) return null;/);
  assert.match(client, /if \(client && !maintenanceMode\) \{/);
});
