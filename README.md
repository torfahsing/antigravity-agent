# antigravity-agent

Fast, standalone coding agent CLI powered by **Google Gemini** and **Antigravity**, built natively with **Bun**.
Conforms to the **SpecFlow Agent CLI Protocol (v1)**.

## Features

- **Blazing Fast**: Native Bun runtime with sub-15ms startup.
- **SpecFlow Protocol v1**: Self-describing capability discovery (`--capabilities`), streaming NDJSON (`-j`), and tool allowance (`--allowedTools`).
- **Standard Tool Suite**: `file_read`, `file_write`, `file_edit`, `shell`, `grep`, `glob`, `list_dir`.
- **Granular Tool Allowance**: Dynamically respects role permission restrictions (e.g. read-only vs write).

## Requirements

- [Bun](https://bun.sh) runtime (`>= 1.1.0`) (only required if running from source; not needed for standalone binaries)
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` set in your environment

---

## Installation & Quick Start

### 1. From Source (Development)

```bash
git clone https://github.com/torfahsing/antigravity-agent.git
cd antigravity-agent
bun install

# Run directly (no build step needed — Bun runs TypeScript natively)
bun run src/cli.ts --capabilities

# Optional: compile standalone executable
bun run build
# outputs binary to bin/antigravity-agent
```

### 2. SpecFlow Integration

To make the CLI available system-wide and in SpecFlow:

```bash
# Symlink launcher into your user bin (already in $PATH)
ln -sf $(pwd)/bin/antigravity-agent ~/.local/bin/antigravity-agent

# Verify
antigravity-agent --capabilities
```

---

## Usage

```bash
# Print capability manifest (tools, categories, models)
antigravity-agent --capabilities

# Execute a prompt with streaming NDJSON
antigravity-agent -j -m gemini-2.5-flash "Analyze the codebase"

# Restrict allowed tools for read-only roles
antigravity-agent --allowedTools file_read grep glob -j -p "Find auth definitions"

# Disable all tools and limit steps (e.g. for reviewer roles)
antigravity-agent --allowedTools none --max-steps 1 -j -p "Review this PR"
```

---

## Cross-Platform Builds & GitHub Releases

### Automated Releases via GitHub Actions
Whenever a version tag is pushed (e.g. `v0.1.0`), GitHub Actions automatically tests, cross-compiles standalone binaries, generates `SHA256SUMS.txt`, and publishes a GitHub Release with assets for:
- `antigravity-agent-linux-x64` (Linux Intel / AMD 64-bit)
- `antigravity-agent-linux-arm64` (Linux ARM 64-bit)
- `antigravity-agent-darwin-arm64` (macOS Apple Silicon M1/M2/M3/M4)
- `antigravity-agent-darwin-x64` (macOS Intel)
- `antigravity-agent-windows-x64.exe` (Windows 64-bit)

To publish a new release:
```bash
git tag v0.1.0
git push origin v0.1.0
```

### Local Cross-Compilation
You can also cross-compile for any target platform directly from your machine using Bun:

```bash
# macOS Apple Silicon
bun build --compile --minify ./src/cli.ts --target=bun-darwin-arm64 --outfile dist/antigravity-agent-darwin-arm64

# Linux x64
bun build --compile --minify ./src/cli.ts --target=bun-linux-x64 --outfile dist/antigravity-agent-linux-x64

# Windows x64
bun build --compile --minify ./src/cli.ts --target=bun-windows-x64 --outfile dist/antigravity-agent-windows-x64.exe
```

---

## Testing

```bash
bun test
```

---

## License

MIT
