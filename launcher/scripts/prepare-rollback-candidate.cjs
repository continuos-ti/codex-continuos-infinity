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

for (let index = 0; index < manifests.length; index++) {
  packages[index].version = candidateVersion;
  fs.writeFileSync(manifests[index], `${JSON.stringify(packages[index], null, 2)}\n`);
}
process.stdout.write(`NSIS_VERSION_ROLLBACK_CANDIDATE ${version} -> ${candidateVersion}\n`);
