// Create a second semantic version only on a disposable Windows CI runner.
// The first package must already have been copied out of launcher/artifacts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "win32" || process.env.CI !== "true"
  || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Windows") {
  throw new Error("Rollback candidate preparation requires a disposable Windows GitHub Actions runner");
}

const repositoryRoot = path.resolve(__dirname, "..", "..");
const manifests = [
  path.join(repositoryRoot, "package.json"),
  path.join(repositoryRoot, "launcher", "package.json"),
];
const packages = manifests.map(file => JSON.parse(fs.readFileSync(file, "utf8")));
assert.equal(packages[0].version, packages[1].version, "Runtime and launcher versions must agree");
const version = packages[0].version;
assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
  "Baseline version must be valid SemVer without build metadata");
const match = /^(.*?)(\d+)$/.exec(version);
assert.ok(match, "Could not derive a distinct candidate version");
const candidateVersion = `${match[1]}${Number(match[2]) + 1}`;
assert.notEqual(candidateVersion, version);

// The packaged runtime embeds src/version.ts independently of package.json.
// Keep every version checked by scripts/check-version.ts coherent in the CI fixture.
const versionFiles = [
  "src/version.ts",
  "scripts/install.sh",
  "README.md",
  "README.zh-CN.md",
  "README.ja.md",
  "README.ko.md",
];
const updatedVersions = versionFiles.map(relativePath => {
  const file = path.join(repositoryRoot, relativePath);
  const original = fs.readFileSync(file, "utf8");
  assert.ok(original.includes(version), `${relativePath} does not contain the baseline version`);
  return { file, updated: original.replaceAll(version, candidateVersion) };
});
assert.equal(fs.readFileSync(path.join(repositoryRoot, "src/version.ts"), "utf8").trim(),
  `export const VERSION = ${JSON.stringify(version)};`, "Unexpected runtime version declaration");

for (let index = 0; index < manifests.length; index++) {
  packages[index].version = candidateVersion;
  fs.writeFileSync(manifests[index], `${JSON.stringify(packages[index], null, 2)}\n`);
}
for (const { file, updated } of updatedVersions) {
  fs.writeFileSync(file, updated);
}
process.stdout.write(`NSIS_VERSION_ROLLBACK_CANDIDATE ${version} -> ${candidateVersion}\n`);
