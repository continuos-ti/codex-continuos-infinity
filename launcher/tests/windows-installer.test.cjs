const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Prefer a modern PowerShell host when installed. Some Windows installations
// have a Restricted policy for legacy powershell.exe even though pwsh permits
// locally authored test scripts. Never change the machine's execution policy.
const candidates = process.env.POWERSHELL_EXE
  ? [process.env.POWERSHELL_EXE]
  : ["pwsh", ...(process.platform === "win32" ? ["powershell.exe"] : [])];
const availability = candidates.map(executable => ({
  executable,
  result: spawnSync(executable, ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" }),
}));
const selected = availability.find(candidate => !candidate.result.error && candidate.result.status === 0);
const powershell = selected?.executable;

test("Windows installer resolves only the official public release redirect", { skip: !selected }, () => {
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-File", path.join(__dirname, "windows-installer.test.ps1")], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /WINDOWS_INSTALLER_REDIRECT_OK/);
});
