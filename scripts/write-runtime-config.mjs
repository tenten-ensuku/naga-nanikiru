import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const APPROVED_MEDIA_API_ORIGIN = "https://minkiru-media.naga-study.workers.dev";
export const MEDIA_READY_BUCKET_NAMES = Object.freeze([
  "naga-question-assets",
  "comment-assets",
  "reaction-assets",
]);

const MEDIA_READY_BUCKET_SET = new Set(MEDIA_READY_BUCKET_NAMES);
const APPROVED_MEDIA_API_HOST = new URL(APPROVED_MEDIA_API_ORIGIN).hostname;

function envText(value) {
  return String(value ?? "").trim();
}

export function normalizeMediaApiUrl(value) {
  const raw = envText(value);
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("MEDIA_API_URL must be a valid URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "r2.dev" || hostname.endsWith(".r2.dev")) {
    throw new Error("MEDIA_API_URL must not use an r2.dev hostname.");
  }
  if (parsed.protocol !== "https:" || !/^https:\/\//i.test(raw)) {
    throw new Error("MEDIA_API_URL must use HTTPS.");
  }
  if (raw.includes("@") || parsed.username || parsed.password) {
    throw new Error("MEDIA_API_URL must not contain credentials.");
  }
  if (raw.includes("?") || raw.includes("#") || parsed.search || parsed.hash) {
    throw new Error("MEDIA_API_URL must not contain a query or fragment.");
  }
  const authorityStart = raw.indexOf("://") + 3;
  const pathStart = raw.indexOf("/", authorityStart);
  if (
    raw.includes("\\") ||
    (pathStart !== -1 && raw.slice(pathStart) !== "/") ||
    parsed.pathname !== "/" ||
    parsed.port
  ) {
    throw new Error("MEDIA_API_URL must be an origin without a path.");
  }
  if (hostname !== APPROVED_MEDIA_API_HOST) {
    throw new Error(`MEDIA_API_URL must use ${APPROVED_MEDIA_API_ORIGIN}.`);
  }

  return parsed.origin;
}

export function parseMediaReadyBuckets(value) {
  const raw = envText(value);
  if (!raw) return [];

  const buckets = raw.split(",").map((bucket) => bucket.trim());
  if (buckets.some((bucket) => !bucket)) {
    throw new Error("MEDIA_READY_BUCKETS must be a comma-separated list of bucket names.");
  }

  const invalidBucket = buckets.find((bucket) => !MEDIA_READY_BUCKET_SET.has(bucket));
  if (invalidBucket) {
    throw new Error(
      `MEDIA_READY_BUCKETS contains an unsupported bucket: ${invalidBucket}. ` +
      `Allowed buckets: ${MEDIA_READY_BUCKET_NAMES.join(", ")}.`,
    );
  }
  return [...new Set(buckets)];
}

export function buildRuntimeConfig(env = process.env) {
  const supabaseUrl = envText(env?.SUPABASE_URL);
  const publishableKey = envText(env?.SUPABASE_PUBLISHABLE_KEY);

  if (!supabaseUrl || !publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.");
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
    throw new Error("SUPABASE_URL must be an https://*.supabase.co URL.");
  }
  if (/^(sb_secret_|eyJ)/i.test(publishableKey)) {
    throw new Error("Only the browser-safe Supabase publishable key is allowed.");
  }

  const mediaApiUrl = normalizeMediaApiUrl(env?.MEDIA_API_URL);
  const mediaReadyBuckets = parseMediaReadyBuckets(env?.MEDIA_READY_BUCKETS);
  if (mediaReadyBuckets.length > 0 && !mediaApiUrl) {
    throw new Error("MEDIA_READY_BUCKETS requires MEDIA_API_URL.");
  }

  const config = {
    supabaseUrl,
    supabasePublishableKey: publishableKey,
  };
  if (mediaApiUrl) {
    config.mediaApiUrl = mediaApiUrl;
    config.mediaReadyBuckets = mediaReadyBuckets;
  }
  return config;
}

export function renderRuntimeConfig(config) {
  return `// Generated at deploy time. Never put a Supabase secret/service-role key here.\nwindow.NAGA_RUNTIME_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`;
}

export async function writeRuntimeConfig(env = process.env) {
  const source = renderRuntimeConfig(buildRuntimeConfig(env));
  await fs.writeFile(new URL("../public/runtime-config.js", import.meta.url), source, "utf8");
  console.log("Wrote public/runtime-config.js");
}

const isDirectInvocation = Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  await writeRuntimeConfig(process.env);
}
