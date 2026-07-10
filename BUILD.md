# Build and Artifacts

## Folder roles

- `src/`, `electron/`, `runner/`, `skills/`, `scripts/`: source and runtime code.
- `dist/`: Vite renderer build output.
- `build/python/`: bundled Python runtime used by the packaged app.
- `artifacts/prepackaged/`: Electron app folder prepared before portable packaging.
- `artifacts/portable/`: default portable exe output.
- `artifacts/legacy/`: older release folders kept for reference.

## Build portable exe

Run Node and pnpm commands from Git Bash.

Open Git Bash in the repository root, then run:

```bash
pnpm run harness:release
```

This is the recommended release gate. It builds the renderer, runs smoke checks, prepares a timestamped prepackaged app, creates a portable exe, launches the exe, verifies that the process stays alive for at least five seconds, writes a SHA256 hash, and stores a Flight Recorder report under `.harness/runs/<run_id>`.

For manual packaging only, run:

```bash
pnpm run dist:win
```

The default output is:

```text
artifacts/portable/Agent Flight Recorder-0.1.0-win-x64.exe
```

Older root-level `release*` folders are legacy build outputs. If they cannot be moved, Windows is probably holding files such as `default_app.asar`; close running app windows and Explorer previews, then move them under `artifacts/legacy/`.

## Avoid locked release folders

If Windows locks a previous prepackaged folder, use timestamped output paths:

```bash
export FLIGHT_RECORDER_PREPACKAGED_DIR="artifacts/prepackaged-$(date +%Y%m%d-%H%M%S)"
export FLIGHT_RECORDER_PORTABLE_DIR="artifacts/portable-$(date +%Y%m%d-%H%M%S)"

pnpm run prepare:prepackaged
pnpm exec electron-builder --win portable --prepackaged "$FLIGHT_RECORDER_PREPACKAGED_DIR" -c.directories.output="$FLIGHT_RECORDER_PORTABLE_DIR"
```
