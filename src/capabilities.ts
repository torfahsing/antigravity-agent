export interface AgentToolCapability {
  id: string;
  name: string;
  category: 'read' | 'write' | 'execute' | 'search' | 'web' | 'metadata';
  readOnly: boolean;
  description: string;
}

export interface AgentCategoryCapability {
  id: string;
  name: string;
  default: boolean;
}

export interface AgentFeatures {
  models?: boolean;
  quota?: boolean;
  streaming?: boolean;
  sessions?: boolean;
}

export interface AgentCapabilities {
  name: string;
  version: string;
  protocol: string;
  description: string;
  tools: AgentToolCapability[];
  categories: AgentCategoryCapability[];
  supportedModels: string[];
  features?: AgentFeatures;
}

export const ANTIGRAVITY_AGENT_CAPABILITIES: AgentCapabilities = {
  name: 'antigravity-agent',
  version: '0.1.0',
  protocol: 'specflow-agent-v1',
  description: 'Native Bun agent powered by Google Gemini and Antigravity with tool calling',
  tools: [
    {
      id: 'file_read',
      name: 'Read File',
      category: 'read',
      readOnly: true,
      description: 'Read file contents with line range support',
    },
    {
      id: 'file_write',
      name: 'Write File',
      category: 'write',
      readOnly: false,
      description: 'Create or overwrite files',
    },
    {
      id: 'file_edit',
      name: 'Edit File',
      category: 'write',
      readOnly: false,
      description: 'Targeted search-and-replace editing in files',
    },
    {
      id: 'shell',
      name: 'Bash Shell',
      category: 'execute',
      readOnly: false,
      description: 'Execute shell commands in current working directory',
    },
    {
      id: 'grep',
      name: 'Grep Search',
      category: 'search',
      readOnly: true,
      description: 'Fast regex search across files',
    },
    {
      id: 'glob',
      name: 'Glob Search',
      category: 'search',
      readOnly: true,
      description: 'Find files matching glob pattern',
    },
    {
      id: 'list_dir',
      name: 'List Directory',
      category: 'read',
      readOnly: true,
      description: 'List directory contents',
    },
  ],
  categories: [
    { id: 'read', name: 'File Reading', default: true },
    { id: 'search', name: 'Code Search', default: true },
    { id: 'write', name: 'File Modification', default: true },
    { id: 'execute', name: 'Shell Execution', default: true },
  ],
  supportedModels: [],
  features: {
    models: true,
    quota: true,
    sessions: true,
  },
};
