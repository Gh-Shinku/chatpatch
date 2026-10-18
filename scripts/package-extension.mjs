import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import yazl from "yazl";

const root = process.cwd();
const distDir = path.join(root, "dist");
const releaseDir = path.join(root, "release");
const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
const packagePath = path.join(releaseDir, `chatpatch-v${manifest.version}.zip`);

await mkdir(releaseDir, { recursive: true });
await rm(packagePath, { force: true });
await createZip(distDir, packagePath);

async function createZip(sourceDir, outfile) {
  const zipfile = new yazl.ZipFile();
  const output = createWriteStream(outfile);
  const completion = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zipfile.outputStream.on("error", reject);
  });

  zipfile.outputStream.pipe(output);
  await addDirectory(zipfile, sourceDir, "");
  zipfile.end();
  await completion;
}

async function addDirectory(zipfile, absoluteDir, relativeDir) {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name);
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      await addDirectory(zipfile, absolutePath, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    zipfile.addFile(absolutePath, relativePath, {
      mtime: new Date(0),
      mode: fileStat.mode
    });
  }
}
