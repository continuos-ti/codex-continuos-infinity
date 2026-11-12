[CmdletBinding()]
param(
    [string]$WindowsLocalRoot = 'H:\Projetos\windows-local',
    [string]$PythonPath,
    [switch]$Apply,
    [switch]$Rollback
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Replace-Once {
    param(
        [string]$Text,
        [string]$Old,
        [string]$New,
        [string]$Label
    )

    $first = $Text.IndexOf($Old, [StringComparison]::Ordinal)
    if ($first -lt 0 -or $Text.IndexOf($Old, $first + $Old.Length, [StringComparison]::Ordinal) -ge 0) {
        throw "Expected one $Label anchor in windows_control.py."
    }
    return $Text.Substring(0, $first) + $New + $Text.Substring($first + $Old.Length)
}

function Replace-RegexOnce {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Replacement,
        [string]$Label
    )

    $matches = [regex]::Matches($Text, $Pattern)
    if ($matches.Count -ne 1) {
        throw "Expected one $Label block in windows_control.py, found $($matches.Count)."
    }
    $literalReplacement = $Replacement.Replace('$', '$$')
    return [regex]::Replace($Text, $Pattern, $literalReplacement, 1)
}

function Get-PythonExecutable {
    if ($PythonPath) {
        if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
            throw "Python executable not found at $PythonPath."
        }
        return $PythonPath
    }

    $venvPython = Join-Path $WindowsLocalRoot '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
        return $venvPython
    }

    $pythonCommand = Get-Command python.exe -ErrorAction Stop
    return $pythonCommand.Source
}

function Test-PythonSyntax {
    param([string]$Path)
    & $python -c 'import pathlib, sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding=''utf-8''), sys.argv[1], ''exec'')' $Path
    if ($LASTEXITCODE -ne 0) {
        throw "Python syntax validation failed for $Path."
    }
}

$WindowsLocalRoot = (Resolve-Path -LiteralPath $WindowsLocalRoot).Path
$controlPath = Join-Path $WindowsLocalRoot 'windows_control.py'
$moduleTarget = Join-Path $WindowsLocalRoot 'durable_command_jobs.py'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleSource = Join-Path $sourceRoot 'durable_command_jobs.py'
$backupRoot = Join-Path $WindowsLocalRoot 'backups\codex-infinity-durable-jobs'
$encoding = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $controlPath -PathType Leaf)) {
    throw "Windows Local source not found at $controlPath."
}
if (-not (Test-Path -LiteralPath $moduleSource -PathType Leaf)) {
    throw "Integration module not found at $moduleSource."
}
if ($Apply -and $Rollback) {
    throw 'Choose either -Apply or -Rollback.'
}

$python = Get-PythonExecutable

if ($Rollback) {
    $latestBackup = Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if ($null -eq $latestBackup) {
        throw 'No Windows Local integration backup is available for rollback.'
    }

    $controlBackup = Join-Path $latestBackup.FullName 'windows_control.py'
    if (-not (Test-Path -LiteralPath $controlBackup -PathType Leaf)) {
        throw "The latest backup is incomplete at $($latestBackup.FullName)."
    }
    Copy-Item -LiteralPath $controlBackup -Destination $controlPath -Force

    $moduleBackup = Join-Path $latestBackup.FullName 'durable_command_jobs.py'
    $moduleWasAbsent = Join-Path $latestBackup.FullName 'durable_command_jobs.was-absent'
    if (Test-Path -LiteralPath $moduleBackup -PathType Leaf) {
        Copy-Item -LiteralPath $moduleBackup -Destination $moduleTarget -Force
    }
    elseif (Test-Path -LiteralPath $moduleWasAbsent -PathType Leaf) {
        Remove-Item -LiteralPath $moduleTarget -Force -ErrorAction SilentlyContinue
    }

    Test-PythonSyntax $controlPath
    Write-Output "Rolled back Windows Local source from $($latestBackup.Name). The service was not restarted."
    return
}

$original = [System.IO.File]::ReadAllText($controlPath)
$importMarker = 'from durable_command_jobs import DurableCommandJobs, build_powershell_job_script'
if ($original.Contains($importMarker)) {
    if ((Test-Path -LiteralPath $moduleTarget -PathType Leaf) -and $original.Contains('x-codex-operation-id')) {
        Write-Output 'Durable Windows Local command jobs are already installed.'
        return
    }
    throw 'Windows Local source contains a partial durable-job integration. Reconcile the backup before applying again.'
}

$newline = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
$updated = $original

$updated = Replace-Once `
    $updated `
    ('import uuid' + $newline) `
    ('import uuid' + $newline + $importMarker + $newline) `
    'durable job import'

$stateInitialization = @'
JOBS = {}
_STATE_ROOT = Path(
    os.environ.get("WINDOWS_LOCAL_REMOTE_STATE")
    or (Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "WindowsLocalRemote")
)
COMMAND_JOBS = DurableCommandJobs(_STATE_ROOT)
'@
$updated = Replace-Once $updated ('JOBS = {}' + $newline) ($stateInitialization + $newline) 'job store initialization'

$screenshotPattern = '(?s)def screenshot\(\):\r?\n.*?(?=\r?\ndef observation\()'
$screenshotReplacement = @'
def screenshot():
    image = ImageGrab.grab(all_screens=True)
    left, top = user32.GetSystemMetrics(76), user32.GetSystemMetrics(77)
    original = image.size
    image.thumbnail((2400, 1600))
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    identifier = str(uuid.uuid4())
    shot = {
        'time': time.monotonic(),
        'captured_at': time.time(),
        'left': left,
        'top': top,
        'sx': original[0] / image.width,
        'sy': original[1] / image.height,
        'width': image.width,
        'height': image.height,
        'foreground': str(user32.GetForegroundWindow()),
    }
    SHOTS.clear()
    COMMAND_JOBS.clear_screenshots()
    COMMAND_JOBS.save_screenshot(identifier, shot)
    SHOTS[identifier] = shot
    return {'content': [
        {'type': 'text', 'text': __import__('json').dumps({'screenshot_id': identifier, 'width': image.width, 'height': image.height, 'foreground': shot['foreground'], 'coordinate_system': 'Use x/y da imagem exibida. O servidor converte escala e m\u00faltiplos monitores.'})},
        {'type': 'image', 'data': base64.b64encode(stream.getvalue()).decode(), 'mimeType': 'image/png'}
    ], 'isError': False}
'@
$screenshotReplacement += $newline
$updated = Replace-RegexOnce $updated $screenshotPattern $screenshotReplacement 'screenshot'

$observationPattern = '(?s)def observation\(arguments\):\r?\n.*?(?=\r?\ndef point\()'
$observationReplacement = @'
def observation(arguments):
    identifier = arguments['screenshot_id']
    stored = COMMAND_JOBS.load_screenshot(identifier)
    if stored is None:
        SHOTS.pop(identifier, None)
        raise ValueError('Captura expirada. Tire outra captura.')
    shot = SHOTS.get(identifier)
    if shot is None or abs(float(shot['captured_at']) - float(stored['captured_at'])) >= 0.001:
        age = time.time() - float(stored['captured_at'])
        if age < -5 or age > 60:
            COMMAND_JOBS.delete_screenshot(identifier)
            raise ValueError('Captura expirada. Tire outra captura.')
        stored['time'] = time.monotonic() - max(0, age)
        shot = stored
        SHOTS[identifier] = shot
    if time.monotonic() - shot['time'] > 60:
        COMMAND_JOBS.delete_screenshot(identifier)
        SHOTS.pop(identifier, None)
        raise ValueError('Captura expirada. Tire outra captura.')
    try:
        foreground(shot['foreground'])
    except ValueError:
        COMMAND_JOBS.delete_screenshot(identifier)
        SHOTS.pop(identifier, None)
        raise
    return shot
'@
$observationReplacement += $newline
$updated = Replace-RegexOnce $updated $observationPattern $observationReplacement 'screenshot observation'

$oldFocusStart = '        user32.ShowWindow(hwnd, 9)' + $newline
$newFocusStart = '        SHOTS.clear()' + $newline + '        COMMAND_JOBS.clear_screenshots()' + $newline + '        user32.ShowWindow(hwnd, 9)' + $newline
$updated = Replace-Once $updated $oldFocusStart $newFocusStart 'window focus screenshot invalidation'
$oldFocusClear = "        foreground(a['hwnd'])" + $newline + '        SHOTS.clear()' + $newline + '        return window_info(hwnd)'
$newFocusClear = "        foreground(a['hwnd'])" + $newline + '        return window_info(hwnd)'
$updated = Replace-Once $updated $oldFocusClear $newFocusClear 'window focus screenshot cleanup'

$oldActionObservation = '        shot = observation(a)' + $newline
$newActionObservation = $oldActionObservation + '        SHOTS.clear()' + $newline + '        COMMAND_JOBS.clear_screenshots()' + $newline
$updated = Replace-Once $updated $oldActionObservation $newActionObservation 'input action screenshot invalidation'
$oldActionClear = '        SHOTS.clear()' + $newline + "        return {'performed': name, 'next_step': 'Capture novamente e verifique o resultado.'}"
$newActionClear = "        return {'performed': name, 'next_step': 'Capture novamente e verifique o resultado.'}"
$updated = Replace-Once $updated $oldActionClear $newActionClear 'input action screenshot cleanup'

$jobResultPattern = '(?s)def job_result\(identifier, wait=0\):\r?\n.*?(?=\r?\ndef invoke\()'
$jobResultReplacement = @'
def job_result(identifier, wait=0, provider_epoch=None):
    job = JOBS.get(identifier)
    process = job['process'] if job else None
    return COMMAND_JOBS.result(identifier, provider_epoch=provider_epoch, process=process, wait_seconds=wait)

'@
$jobResultReplacement += $newline
$updated = Replace-RegexOnce $updated $jobResultPattern $jobResultReplacement 'job_result'

$commandPattern = "(?s)    if name == 'windows_command':\r?\n.*?(?=    if name == 'windows_command_result':)"
$commandReplacement = @'
    if name == 'windows_command':
        cwd = Path(a['cwd']).resolve(strict=True)
        if not cwd.is_dir():
            raise ValueError('cwd deve ser uma pasta existente.')
        record, created = COMMAND_JOBS.reserve(a.get('operation_id'), a.get('provider_epoch'), a['command'], str(cwd))
        identifier = record['operation_id']
        if not created:
            return job_result(identifier, a.get('wait_seconds', 1), a.get('provider_epoch'))
        try:
            folder = Path(tempfile.mkdtemp(prefix='windows-chatgpt-command-'))
            paths = {k: folder / (k + '.txt') for k in ['stdout', 'stderr']}
            COMMAND_JOBS.set_output_paths(identifier, str(paths['stdout']), str(paths['stderr']))
            script = build_powershell_job_script(a['command'], record['start_path'], record['exit_path'])
            executable = str(Path(os.environ['SystemRoot']) / 'System32' / 'WindowsPowerShell' / 'v1.0' / 'powershell.exe')
            with open(paths['stdout'], 'wb') as out, open(paths['stderr'], 'wb') as err:
                process = subprocess.Popen([executable, '-NoProfile', '-NonInteractive', '-EncodedCommand', base64.b64encode(script.encode('utf-16-le')).decode()], cwd=cwd, stdin=subprocess.DEVNULL, stdout=out, stderr=err, creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception:
            COMMAND_JOBS.mark_launch_failed(identifier)
            raise
        JOBS[identifier] = {**paths, 'process': process}
        COMMAND_JOBS.mark_started(identifier, process.pid)
        return job_result(identifier, a.get('wait_seconds', 1), a.get('provider_epoch'))
'@
$commandReplacement += $newline
$updated = Replace-RegexOnce $updated $commandPattern $commandReplacement 'windows_command'

$oldResultBranch = "    if name == 'windows_command_result':" + $newline + "        return job_result(a['job_id'], a.get('wait_seconds', 1))"
$newResultBranch = "    if name == 'windows_command_result':" + $newline + "        return job_result(a['job_id'], a.get('wait_seconds', 1), a.get('provider_epoch'))"
$updated = Replace-Once $updated $oldResultBranch $newResultBranch 'windows_command_result'

$schemaAnchor = '    for entry in result:' + $newline
$schemaExtension = @'
    for entry in result:
        if entry['name'] == 'windows_command':
            entry['inputSchema']['properties']['operation_id'] = {
                'type': 'string',
                'pattern': r'^call_[A-Za-z0-9_-]{32}$',
                'description': 'Stable broker call identity injected by Codex Continuos Infinity.'
            }
            entry['inputSchema']['properties']['provider_epoch'] = {
                'type': 'string',
                'pattern': r'^[0-9a-f]{32}$',
                'description': 'Provider ledger epoch injected by Codex Continuos Infinity.'
            }
            entry['inputSchema']['x-codex-operation-id'] = True
            entry['inputSchema']['x-codex-provider-epoch'] = COMMAND_JOBS.epoch
        elif entry['name'] == 'windows_command_result':
            entry['inputSchema']['properties']['provider_epoch'] = {
                'type': 'string',
                'pattern': r'^[0-9a-f]{32}$',
                'description': 'Epoch returned by the original windows_command call.'
            }
    for entry in result:
'@
$schemaExtension += $newline
$updated = Replace-Once $updated $schemaAnchor $schemaExtension 'tool schema extension'

$oldCommandDescription = 'Retorna sa' + [char]0x00ed + 'da ou job_id para acompanhar.'
$newCommandDescription = 'Retorna sa' + [char]0x00ed + 'da e job_id dur' + [char]0x00e1 + 'vel para acompanhar.'
$updated = $updated.Replace($oldCommandDescription, $newCommandDescription)
$oldResultDescription = 'Consulta sa' + [char]0x00ed + 'da e conclus' + [char]0x00e3 + 'o de um comando iniciado nesta sess' + [char]0x00e3 + 'o.'
$newResultDescription = 'Consulta sa' + [char]0x00ed + 'da e conclus' + [char]0x00e3 + 'o de um comando, inclusive ap' + [char]0x00f3 + 's rein' + [char]0x00ed + 'cio do provedor.'
$updated = $updated.Replace($oldResultDescription, $newResultDescription)

$temporaryRoot = Join-Path $env:TEMP ('codex-infinity-windows-local-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
try {
    $temporaryControl = Join-Path $temporaryRoot 'windows_control.py'
    Copy-Item -LiteralPath $moduleSource -Destination (Join-Path $temporaryRoot 'durable_command_jobs.py')
    [System.IO.File]::WriteAllText($temporaryControl, $updated, $encoding)
    Test-PythonSyntax $temporaryControl

    if (-not $Apply) {
        Write-Output 'Dry-run passed. Windows Local source and running processes were not changed.'
        return
    }

    $backupName = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupDirectory = Join-Path $backupRoot $backupName
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    Copy-Item -LiteralPath $controlPath -Destination (Join-Path $backupDirectory 'windows_control.py')
    if (Test-Path -LiteralPath $moduleTarget -PathType Leaf) {
        Copy-Item -LiteralPath $moduleTarget -Destination (Join-Path $backupDirectory 'durable_command_jobs.py')
    }
    else {
        [System.IO.File]::WriteAllText((Join-Path $backupDirectory 'durable_command_jobs.was-absent'), 'true', $encoding)
    }

    try {
        Copy-Item -LiteralPath $moduleSource -Destination $moduleTarget -Force
        [System.IO.File]::WriteAllText($controlPath, $updated, $encoding)
        Test-PythonSyntax $controlPath
    }
    catch {
        Copy-Item -LiteralPath (Join-Path $backupDirectory 'windows_control.py') -Destination $controlPath -Force
        $moduleBackup = Join-Path $backupDirectory 'durable_command_jobs.py'
        if (Test-Path -LiteralPath $moduleBackup -PathType Leaf) {
            Copy-Item -LiteralPath $moduleBackup -Destination $moduleTarget -Force
        }
        else {
            Remove-Item -LiteralPath $moduleTarget -Force -ErrorAction SilentlyContinue
        }
        throw
    }

    Write-Output "Applied Windows Local durable command jobs. Backup: $backupDirectory. The service was not restarted."
}
finally {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
