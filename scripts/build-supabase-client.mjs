import { build } from "vite";

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: "client/supabase-sync.ts",
      formats: ["iife"],
      name: "NagaSupabaseBundle",
      fileName: () => "supabase-sync-v47.js",
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
