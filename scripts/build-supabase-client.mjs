import { build } from "vite";
import { readFile, writeFile } from "node:fs/promises";

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: "client/supabase-sync.ts",
      formats: ["iife"],
      name: "NagaSupabaseBundle",
      fileName: () => "supabase-sync-v48.js",
    },
    outDir: "public",
    minify: "esbuild",
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});

// The SDK's base64 whitespace alphabet is emitted as a multiline template by
// the minifier. Use an equivalent escaped literal so generated lines have no
// trailing whitespace; its runtime characters (including CR and '=') stay exact.
const bundlePath = new URL("../public/supabase-sync-v48.js", import.meta.url);
const bundle = await readFile(bundlePath, "utf8");
const normalized = bundle.replaceAll("` \t\n\\r=`", JSON.stringify(" \t\n\r="));
if (normalized !== bundle) await writeFile(bundlePath, normalized);
