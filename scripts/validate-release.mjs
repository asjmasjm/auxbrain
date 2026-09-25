import { existsSync, readFileSync, statSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson("manifest.json");
const packageJson = readJson("package.json");
const versions = readJson("versions.json");
const errors = [];

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  errors.push("manifest.json version must use x.y.z format");
}
if (packageJson.version !== manifest.version) {
  errors.push("package.json and manifest.json versions must match");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  errors.push("versions.json must map the current version to minAppVersion");
}
if (!manifest.id || manifest.id.toLowerCase().includes("obsidian")) {
  errors.push("manifest id must be present and must not contain 'obsidian'");
}
if (manifest.isDesktopOnly !== true) {
  errors.push("AuxBrain requires its desktop companion service");
}

for (const path of ["main.js", "manifest.json", "styles.css", "README.md", "LICENSE"]) {
  if (!existsSync(path) || statSync(path).size === 0) {
    errors.push(`${path} is missing or empty`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`AuxBrain ${manifest.version} release assets are valid.`);
