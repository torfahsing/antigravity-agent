import { executeFileRead } from './file-read.js';
import { executeFileWrite } from './file-write.js';
import { executeFileEdit } from './file-edit.js';
import { executeShell } from './shell.js';
import { executeGrep } from './grep.js';
import { executeGlob } from './glob.js';
import { executeListDir } from './list-dir.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'file_read',
    description: 'Read the contents of a file with line numbering and optional range slicing',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Relative or absolute file path to read' },
        offset: { type: 'INTEGER', description: '1-based starting line number (default: 1)' },
        limit: { type: 'INTEGER', description: 'Number of lines to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_write',
    description: 'Create a new file or overwrite an existing file with complete contents',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File path to write to' },
        content: { type: 'STRING', description: 'The exact string content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'file_edit',
    description: 'Perform targeted replacement of unique code snippet in an existing file',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File path to modify' },
        targetContent: { type: 'STRING', description: 'Exact string to be replaced (must be unique)' },
        replacementContent: { type: 'STRING', description: 'New string content to replace it with' },
      },
      required: ['path', 'targetContent', 'replacementContent'],
    },
  },
  {
    name: 'shell',
    description: 'Execute a bash command in the project directory',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Bash shell command to run' },
        timeout: { type: 'INTEGER', description: 'Timeout in seconds (default: 120)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'grep',
    description: 'Search for a regex or string pattern within files in the workspace',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING', description: 'Pattern or text to search for' },
        path: { type: 'STRING', description: 'Directory or file to search in (default: current directory)' },
        caseInsensitive: { type: 'BOOLEAN', description: 'Case-insensitive search' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.css")',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING', description: 'Glob pattern to search for' },
        path: { type: 'STRING', description: 'Directory path to scan within' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and subdirectories within a directory path',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Directory path to list (default: current directory)' },
      },
    },
  },
];

export async function executeToolCall(
  name: string,
  args: Record<string, any>,
  allowedTools?: string[],
  cwd = process.cwd()
): Promise<string> {
  if (allowedTools && allowedTools.length > 0) {
    if (allowedTools.includes('none')) {
      return JSON.stringify({ error: `Tool execution blocked: all tools are disabled by allowedTools: none` });
    }
    const isAllowed = allowedTools.some(
      pat => pat === name || (name === 'shell' && (pat === 'Bash' || pat === 'shell'))
    );
    if (!isAllowed) {
      return JSON.stringify({
        error: `Tool "${name}" is blocked by allowedTools policy. Allowed tools: ${JSON.stringify(allowedTools)}`,
      });
    }
  }

  switch (name) {
    case 'file_read':
      return executeFileRead(args as any, cwd);
    case 'file_write':
      return executeFileWrite(args as any, cwd);
    case 'file_edit':
      return executeFileEdit(args as any, cwd);
    case 'shell':
      return executeShell(args as any, cwd);
    case 'grep':
      return executeGrep(args as any, cwd);
    case 'glob':
      return executeGlob(args as any, cwd);
    case 'list_dir':
      return executeListDir(args as any, cwd);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
