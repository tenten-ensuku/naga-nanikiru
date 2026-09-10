import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLOUDFLARE_ENTRY_SOURCE = path.join(REPO_ROOT, "cloudflare", "github-entry.html");
export const CLOUDFLARE_ENTRY_MODES = new Set(["ci", "staging"]);

export function parseCloudflareEntryArgs(argv = process.argv.slice(2)) {
  const result = { outputDir: "", mode: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index] || "");
    if (argument === "--output-dir") {
      result.outputDir = String(argv[++index] || "");
    } else if (argument.startsWith("--output-dir=")) {
      result.outputDir = argument.slice("--output-dir=".length);
    } else if (argument === "--mode") {
      result.mode = String(argv[++index] || "");
    } else if (argument.startsWith("--mode=")) {
      result.mode = argument.slice("--mode=".length);
    } else if (argument === "--help") {
      return { help: true, outputDir: "", mode: "" };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!result.outputDir) throw new Error("An explicit --output-dir is required; the current public directory is never selected automatically.");
  if (!CLOUDFLARE_ENTRY_MODES.has(result.mode)) throw new Error("An explicit --mode ci or --mode staging is required.");
  return result;
}

export async function prepareCloudflareEntry({ outputDir, mode, sourceFile = CLOUDFLARE_ENTRY_SOURCE } = {}) {
  if (!outputDir || typeof outputDir !== "string") {
    throw new Error("An explicit --output-dir is required; the current public directory is never selected automatically.");
  }
  if (!CLOUDFLARE_ENTRY_MODES.has(mode)) {
    throw new Error("An explicit --mode ci or --mode staging is required.");
  }

  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedSourceFile = path.resolve(sourceFile);
  const destination = path.join(resolvedOutputDir, "index.html");
  if (resolvedSourceFile === destination) throw new Error("The entry source and output must be different files.");

  const directory = await fs.stat(resolvedOutputDir).catch(() => null);
  if (!directory?.isDirectory()) throw new Error(`Output directory does not exist: ${resolvedOutputDir}`);
  const source = await fs.stat(resolvedSourceFile).catch(() => null);
  if (!source?.isFile()) throw new Error(`Entry source does not exist: ${resolvedSourceFile}`);

  await fs.copyFile(resolvedSourceFile, destination);
  return { mode, sourceFile: resolvedSourceFile, outputFile: destination };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseCloudflareEntryArgs();
    if (args.help) {
      console.log("Usage: node scripts/prepare-cloudflare-entry.mjs --output-dir <staging-or-ci-dir> --mode <ci|staging>");
      process.exit(0);
    }
    const result = await prepareCloudflareEntry(args);
    console.log(`Cloudflare static entry prepared in ${result.outputFile} (${result.mode}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
