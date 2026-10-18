import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(process.cwd(), ".test-build");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await bundleNode("src/shared/settings.ts", "shared/settings.cjs");
await bundleNode("src/extractor.ts", "extractor.cjs");
await bundleNode("src/selection.ts", "selection.cjs");
await bundleNode("src/chatgpt.ts", "chatgpt.cjs");
await bundleNode("src/link-cleanup.ts", "link-cleanup.cjs");
await bundleBrowser("src/content/clipboard.ts", "content/clipboard.js");
await bundleBrowser("src/popup.ts", "popup.js");

async function bundleNode(entryPoint, outfile) {
  await build({
    entryPoints: [entryPoint],
    outfile: path.join(outDir, outfile),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "es2022",
    logLevel: "silent"
  });
}

async function bundleBrowser(entryPoint, outfile) {
  await build({
    entryPoints: [entryPoint],
    outfile: path.join(outDir, outfile),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
}
