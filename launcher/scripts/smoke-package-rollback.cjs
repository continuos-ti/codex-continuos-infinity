// Exercise an actual packaged launcher upgrade and rollback with an isolated profile.
// Arguments are two independently built Windows NSIS installers: baseline, candidate.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateRuntimeBundle } = require("../electron/runtime-install.cjs");

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Packaged rollback smoke requires Windows x64");
}
const realInstall = process.argv[4] === "--nsis";
if ((process.argv.length !== 4 && !(process.argv.length === 5 && realInstall))) {
  throw new Error("Usage: node smoke-package-rollback.cjs <baseline-installer.exe> <candidate-installer.exe> [--nsis]");
}
if (realInstall && (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true"
  || process.env.RUNNER_OS !== "Windows")) {
  throw new Error("NSIS rollback smoke requires an explicit disposable Windows GitHub Actions runner");
}
const installers = process.argv.slice(2, 4).map(input => path.resolve(input));
assert.notEqual(installers[0], installers[1], "Rollback requires two distinct installer files");
for (const installer of installers) {
  assert.match(path.basename(installer), /^codex-continuos-infinity-.*-win-x64\.exe$/i);
  assert.ok(fs.statSync(installer).isFile(), `Installer is missing: ${installer}`);
}

const sevenZip = process.env.SEVEN_ZIP_EXE
  || ["C:\\Program Files\\7-Zip\\7z.exe", "C:\\ProgramData\\chocolatey\\bin\\7z.exe"]
    .find(candidate => fs.existsSync(candidate)) || "7z";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "infinity-real-rollback-"));
const coreHome = path.join(scratch, "core-home");
const dataHome = path.join(scratch, "launcher-data");
const codexHome = path.join(scratch, "codex-home");
const markerPath = path.join(scratch, "ready.json");
const env = {
  ...process.env,
  CODEX_CONTINUOS_INFINITY_DATA_DIR: dataHome,
  CODEX_CONTINUOS_INFINITY_HOME: coreHome,
  CODEX_HOME: codexHome,
  CODEX_WEB_GPT_SMOKE_FILE: markerPath,
};
const launcherManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const registryKey = `HKCU\\Software\\${launcherManifest.build.nsis.guid}`;

function installedLocation() {
  const query = spawnSync("reg.exe", ["query", registryKey, "/v", "InstallLocation"], {
    encoding: "utf8", windowsHide: true,
  });
  if (query.error || query.status !== 0) {
    throw new Error(`NSIS registration could not be read: ${query.error?.message || query.stderr?.trim() || query.status}`);
  }
  const match = query.stdout.match(/^\s*InstallLocation\s+REG_SZ\s+(.+?)\s*$/mi);
  assert.ok(match && path.win32.isAbsolute(match[1]), "NSIS registered an invalid installation location");
  return match[1];
}

function isRegistered() {
  const query = spawnSync("reg.exe", ["query", registryKey], {
    encoding: "utf8", windowsHide: true,
  });
  if (query.error || ![0, 1].includes(query.status)) {
    throw new Error(`NSIS registration check failed: ${query.error?.message || query.stderr?.trim() || query.status}`);
  }
  return query.status === 0;
}

function sha256File(file) {
  const digest = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest("hex");
}

function run(executable, args, timeout = 120_000) {
  const result = spawnSync(executable, args, {
    cwd: scratch, env, encoding: "utf8", windowsHide: true,
    timeout, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Rollback smoke command failed (${result.status}): ${result.error?.message || result.stderr?.trim() || result.stdout?.trim() || "unknown"}`);
  }
}

function packageInfo(installer, label) {
  const outer = path.join(scratch, `${label}-archive`);
  const unpacked = path.join(scratch, `${label}-unpacked`);
  fs.mkdirSync(outer);
  fs.mkdirSync(unpacked);
  run(sevenZip, ["e", installer, `-o${outer}`, "-y", "$PLUGINSDIR\\app-64.7z"]);
  const payload = path.join(outer, "app-64.7z");
  assert.ok(fs.existsSync(payload), "NSIS payload is missing");
  run(sevenZip, ["x", payload, `-o${unpacked}`, "-y"]);
  const executable = path.join(unpacked, "Codex Continuos Infinity.exe");
  assert.ok(fs.existsSync(executable), "Packaged Infinity executable is missing");
  const runtime = path.join(unpacked, "resources", "runtime");
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "manifest.json"), "utf8"));
  const identity = { version: manifest.appVersion, platform: "win32", arch: "x64" };
  validateRuntimeBundle(runtime, identity);
  assert.match(manifest.bundleId, /^[a-f0-9]{64}$/);
  return { executable, installer, identity, bundleId: manifest.bundleId };
}

function assertPreservedProfile(markers) {
  for (const [file, value] of markers) {
    assert.equal(fs.readFileSync(file, "utf8"), value, `A package launch changed user state: ${file}`);
  }
}

function bootPackage(info, label, markers) {
  let executable = info.executable;
  if (realInstall) {
    run(info.installer, ["/S", "/currentuser"], 180_000);
    executable = path.join(installedLocation(), "Codex Continuos Infinity.exe");
    assert.ok(fs.existsSync(executable), `${label} NSIS installation has no executable`);
  }
  fs.rmSync(markerPath, { force: true });
  run(executable, ["--launcher-smoke-test"], 90_000);
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  assert.equal(marker.ok, true);
  assert.equal(marker.packaged, true);
  assert.equal(marker.runtimeVerified, true);
  assert.equal(marker.version, info.identity.version);
  assert.equal(marker.platform, "win32");
  const versions = path.join(coreHome, "versions");
  const installed = path.join(versions, `${info.identity.version}-win32-x64`);
  validateRuntimeBundle(installed, { ...info.identity, bundleId: info.bundleId });
  const installedManifest = JSON.parse(fs.readFileSync(path.join(installed, "manifest.json"), "utf8"));
  assert.equal(installedManifest.bundleId, info.bundleId, `${label} did not load the intended build`);
  assert.deepEqual(fs.readdirSync(versions).filter(name => /\.(?:tmp|previous)-/.test(name)), []);
  assertPreservedProfile(markers);
  process.stdout.write(`ROLLBACK_STAGE_OK ${label} ${info.identity.version} ${info.bundleId.slice(0, 16)}\n`);
}

try {
  const baseline = packageInfo(installers[0], "baseline");
  const candidate = packageInfo(installers[1], "candidate");
  assert.notEqual(baseline.bundleId, candidate.bundleId, "The two packages contain an identical runtime");
  if (realInstall) {
    assert.notEqual(baseline.identity.version, candidate.identity.version,
      "NSIS rollback requires distinct semantic versions");
    assert.equal(isRegistered(), false,
      "Refusing NSIS rollback smoke because this runner already has an Infinity installation");
  }

  const markers = [
    [path.join(coreHome, "settings.fixture"), "persisted-user-preferences\n"],
    [path.join(dataHome, "session.fixture"), "persisted-launcher-session\n"],
    [path.join(codexHome, "workspace.fixture"), "persisted-codex-workspace\n"],
  ];
  for (const [file, value] of markers) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { flag: "wx" });
  }

  bootPackage(baseline, "baseline", markers);
  bootPackage(candidate, "upgrade", markers);
  bootPackage(baseline, "rollback", markers);
  // A second forward transition also verifies the saved candidate can be reinstalled.
  bootPackage(candidate, "re-upgrade", markers);
  if (realInstall) {
    const installRoot = installedLocation();
    const uninstallers = fs.readdirSync(installRoot).filter(name => /^Uninstall .+\.exe$/i.test(name));
    assert.equal(uninstallers.length, 1, "Expected exactly one NSIS uninstaller");
    run(path.join(installRoot, uninstallers[0]), ["/S"], 180_000);
    const deadline = Date.now() + 45_000;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (isRegistered() || fs.existsSync(path.join(installRoot, "Codex Continuos Infinity.exe"))) {
      if (Date.now() >= deadline) throw new Error("NSIS uninstall did not finish within 45 seconds");
      Atomics.wait(pause, 0, 0, 250);
    }
    assertPreservedProfile(markers);
    validateRuntimeBundle(path.join(coreHome, "versions", `${baseline.identity.version}-win32-x64`),
      { ...baseline.identity, bundleId: baseline.bundleId });
    validateRuntimeBundle(path.join(coreHome, "versions", `${candidate.identity.version}-win32-x64`),
      { ...candidate.identity, bundleId: candidate.bundleId });
    process.stdout.write("NSIS_VERSION_ROLLBACK_UNINSTALL_OK\n");
  }
  const digests = installers.map(sha256File);
  process.stdout.write(`PACKAGED_LAUNCHER_ROLLBACK_SMOKE_OK win32/x64 baseline_sha256=${digests[0]} candidate_sha256=${digests[1]}\n`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
