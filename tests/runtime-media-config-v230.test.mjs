import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  APPROVED_MEDIA_API_ORIGIN,
  buildRuntimeConfig,
  renderRuntimeConfig,
} from "../scripts/write-runtime-config.mjs";

const BASE_ENV = Object.freeze({
  SUPABASE_URL: "https://akabzpfknwsdmabavcqz.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
});
const BASE_CONFIG = Object.freeze({
  supabaseUrl: BASE_ENV.SUPABASE_URL,
  supabasePublishableKey: BASE_ENV.SUPABASE_PUBLISHABLE_KEY,
});

function env(overrides = {}) {
  return { ...BASE_ENV, ...overrides };
}

test("V230 rejects missing Supabase config and keeps the publishable-key guard", () => {
  assert.throws(
    () => buildRuntimeConfig({}),
    /SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required/,
  );
  assert.throws(
    () => buildRuntimeConfig(env({ SUPABASE_PUBLISHABLE_KEY: "sb_secret_test-key" })),
    /Only the browser-safe Supabase publishable key is allowed/,
  );
  assert.throws(
    () => buildRuntimeConfig(env({ SUPABASE_PUBLISHABLE_KEY: "eyJserver-secret" })),
    /Only the browser-safe Supabase publishable key is allowed/,
  );
});

test("V230 leaves R2 disabled when the optional media envs are absent", async () => {
  const config = buildRuntimeConfig(env());
  assert.deepEqual(config, BASE_CONFIG);
  assert.doesNotMatch(renderRuntimeConfig(config), /mediaApiUrl|mediaReadyBuckets/);

  const runtimeConfigPath = new URL("../public/runtime-config.js", import.meta.url);
  const before = await fs.readFile(runtimeConfigPath, "utf8");
  renderRuntimeConfig(config);
  const after = await fs.readFile(runtimeConfigPath, "utf8");
  assert.equal(after, before, "tests must not write public/runtime-config.js");
});

test("V230 accepts only the approved HTTPS media origin and explicit public ready buckets", () => {
  const config = buildRuntimeConfig(env({
    MEDIA_API_URL: `${APPROVED_MEDIA_API_ORIGIN}/`,
    MEDIA_READY_BUCKETS: " naga-question-assets, comment-assets, reaction-assets, comment-assets ",
  }));

  assert.deepEqual(config, {
    ...BASE_CONFIG,
    mediaApiUrl: APPROVED_MEDIA_API_ORIGIN,
    mediaReadyBuckets: ["naga-question-assets", "comment-assets", "reaction-assets"],
  });
  const rendered = renderRuntimeConfig(config);
  assert.match(rendered, /mediaApiUrl/);
  assert.match(rendered, /mediaReadyBuckets/);
  assert.doesNotMatch(rendered, /sb_secret_|SUPABASE_SECRET_KEY|service_role/i);
});

test("V230 rejects unsafe media origins and ready buckets without guessing defaults", () => {
  for (const mediaApiUrl of [
    "http://minkiru-media.naga-study.workers.dev",
    "https:minkiru-media.naga-study.workers.dev",
    "https://user:password@minkiru-media.naga-study.workers.dev",
    "https://minkiru-media.naga-study.workers.dev/v1",
    "https://minkiru-media.naga-study.workers.dev/./",
    "https://minkiru-media.naga-study.workers.dev/a/..",
    "https://minkiru-media.naga-study.workers.dev?download=1",
    "https://minkiru-media.naga-study.workers.dev#fragment",
    "https://assets.r2.dev",
    "https://other.naga-study.workers.dev",
    "https://media.example.test",
  ]) {
    assert.throws(
      () => buildRuntimeConfig(env({ MEDIA_API_URL: mediaApiUrl })),
      /MEDIA_API_URL/,
      mediaApiUrl,
    );
  }

  assert.throws(
    () => buildRuntimeConfig(env({ MEDIA_READY_BUCKETS: "comment-assets" })),
    /MEDIA_READY_BUCKETS requires MEDIA_API_URL/,
  );
  for (const mediaReadyBuckets of [
    "question-assets",
    "comment-assets,unknown-assets",
    "comment-assets,,reaction-assets",
  ]) {
    assert.throws(
      () => buildRuntimeConfig(env({ MEDIA_API_URL: APPROVED_MEDIA_API_ORIGIN, MEDIA_READY_BUCKETS: mediaReadyBuckets })),
      /MEDIA_READY_BUCKETS/,
      mediaReadyBuckets,
    );
  }
});
