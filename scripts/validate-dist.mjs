import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const manifestPath = path.join(distDir, "manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error("dist/manifest.json is missing");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const required = [
  "background.js",
  manifest.action && manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((entry) => [
    ...(entry.js || []),
    ...(entry.css || [])
  ])
].filter(Boolean);

for (const file of required) {
  if (file.includes("src/")) {
    throw new Error(`dist manifest references source path: ${file}`);
  }

  if (!existsSync(path.join(distDir, file))) {
    throw new Error(`dist manifest references missing file: ${file}`);
  }
}

if (manifest.manifest_version !== 3) {
  throw new Error("dist manifest must be Manifest V3");
}

await assertBuiltFromTypeScript("background.js", ["src/background.ts"]);
await assertBuiltFromTypeScript("content.js", [
  "src/chatgpt.ts",
  "src/link-cleanup.ts",
  "src/content.ts",
  "src/extractor.ts",
  "src/selection.ts"
]);
await assertBuiltFromTypeScript("popup.js", ["src/popup.ts"]);

async function assertBuiltFromTypeScript(file, sources) {
  const text = await readFile(path.join(distDir, file), "utf8");

  for (const source of sources) {
    if (!text.includes(source)) {
      throw new Error(`${file} was not built from ${source}`);
    }
  }
}
