# antigravity-agent

Fast, standalone coding agent CLI powered by **Google Gemini** and **Antigravity**, built natively with **Bun**.
Conforms to the **SpecFlow Agent CLI Protocol (v1)**.

## Features

- **Blazing Fast**: Native Bun runtime with sub-15ms startup.
- **SpecFlow Protocol v1**: Self-describing capability discovery (`--capabilities`), streaming NDJSON (`-j`), and tool allowance (`--allowedTools`).
- **Standard Tool Suite**: `file_read`, `file_write`, `file_edit`, `shell`, `grep`, `glob`, `list_dir`.
- **Granular Tool Allowance**: Dynamically respects role permission restrictions (e.g. read-only vs write).

## Usage

```bash
# Print capability manifest (tools, categories, models)
antigravity-agent --capabilities

# Execute a prompt with streaming NDJSON
antigravity-agent -j -m gemini-2.5-flash "Analyze the codebase"

# Restrict allowed tools for read-only roles
antigravity-agent --allowedTools file_read grep glob -p "Find auth definitions"
```

## Testing

```bash
bun test
```
