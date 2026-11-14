# Windows Local durable command jobs

This integration gives Windows Local durable `screenshot_id` metadata and gives `windows_command` a stable broker operation ID with a provider-side status record.

## Contract

- The Codex Infinity adapter injects `operation_id` from the broker's `callId` when a tool schema advertises `x-codex-operation-id`.
- The adapter injects the provider's current `provider_epoch` when a tool schema advertises `x-codex-provider-epoch`.
- `windows_command` advertises `x-codex-operation-status`, binding its operation ID and provider epoch to the `windows_command_result` query. The status tool explicitly advertises `x-codex-read-only`, and the bridge persists this validated contract with the broker call journal.
- Windows Local records the operation ID, a SHA-256 digest of the command and working directory, process identity, and durable start/exit markers in SQLite under `%LOCALAPPDATA%\WindowsLocalRemote` or `WINDOWS_LOCAL_REMOTE_STATE`.
- Windows Local records the active screenshot ID, capture timestamp, monitor origin, coordinate scale, dimensions, and foreground window in the same SQLite ledger. It does not persist screenshot pixels. The existing 60-second expiry and foreground-window check still apply after a server restart.
- Repeating the same operation ID and the same command returns its existing state. Reusing that ID with different command arguments is rejected. An explicit operation ID requires the matching provider epoch, including on the first dispatch. Legacy calls without either field receive a new random operation ID.
- Concurrent completion observers serialize their updates in SQLite. A confirmed exit code stays immutable, and a launch failure cannot become a completed job.
- A reserved operation remains `starting` until the wrapper writes its durable start marker. The provider reports `running` only after it verifies the process ID and creation time.
- `windows_command_result` can reattach to a still-running PowerShell wrapper after the Windows Local service process restarts. It reports a completed result when the wrapper's durable exit marker is present.
- A provider epoch mismatch is reported as `provider_changed`. A missing record without the original epoch is reported as `epoch_required`. A missing record with the matching epoch remains non-authoritative and does not authorize replay.
- If the process identity cannot be verified or the process disappears without an exit marker, the status remains `unknown`.

The status contract covers the tracked PowerShell wrapper process. A `completed` state and exit code do not prove that detached processes, child services, or other external resources reached their intended state. Those effects still require resource-specific read-only verification before the task can be resumed.

The ledger stores command and working-directory digests, not their raw values. Standard output and standard error remain in the existing temporary output files. The result exposes their last 64 KB when those files are still available.

`completed` confirms the tracked PowerShell wrapper's exit code. Detached processes or external services started by a command remain outside this provider's process ledger and require their own status query. The bridge never replays an unknown operation automatically.

## Validation and installation

The integration module and its tests are in this folder. Run the tests with Python 3.12 or later.

```powershell
python -m unittest discover -s integrations\windows-local\tests -v
```

The source installer defaults to a read-only dry run. It stages a copy of `windows_control.py`, applies the source changes there, and compiles the result.

```powershell
.\integrations\windows-local\apply-durable-command-jobs.ps1
```

After active Windows Local calls have drained, apply the integration with an explicit switch.

```powershell
.\integrations\windows-local\apply-durable-command-jobs.ps1 -Apply
```

The installer creates a timestamped source backup and does not restart Windows Local. Restart the service only during a controlled window after confirming that no active Codex operations depend on it.

Rollback restores the latest timestamped backup and also leaves the service running.

```powershell
.\integrations\windows-local\apply-durable-command-jobs.ps1 -Rollback
```

This provider integration covers `windows_command`. Other MCP providers need to advertise the same schema extensions and implement their own durable operation/status contract before their effects can be reconciled after a crash.
