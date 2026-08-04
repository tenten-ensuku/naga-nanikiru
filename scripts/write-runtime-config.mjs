import fs from "node:fs/promises";
import process from "node:process";

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();

if (!supabaseUrl || !publishableKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.");
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  throw new Error("SUPABASE_URL must be an https://*.supabase.co URL.");
}
if (/^(sb_secret_|eyJ)/i.test(publishableKey)) {
  throw new Error("Only the browser-safe Supabase publishable key is allowed.");
}

const source = `// Generated at deploy time. Never put a Supabase secret/service-role key here.\nwindow.NAGA_RUNTIME_CONFIG = Object.freeze(${JSON.stringify({
  supabaseUrl,
  supabasePublishableKey: publishableKey,
}, null, 2)});\n`;

await fs.writeFile(new URL("../public/runtime-config.js", import.meta.url), source, "utf8");
console.log("Wrote public/runtime-config.js");
