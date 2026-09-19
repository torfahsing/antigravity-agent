import { describe, it, expect } from 'bun:test';
import { ANTIGRAVITY_AGENT_CAPABILITIES } from '../capabilities.js';

describe('antigravity-agent capabilities', () => {
  it('conforms to specflow-agent-v1 protocol', () => {
    expect(ANTIGRAVITY_AGENT_CAPABILITIES.protocol).toBe('specflow-agent-v1');
    expect(ANTIGRAVITY_AGENT_CAPABILITIES.name).toBe('antigravity-agent');
    expect(Array.isArray(ANTIGRAVITY_AGENT_CAPABILITIES.tools)).toBe(true);
    expect(Array.isArray(ANTIGRAVITY_AGENT_CAPABILITIES.categories)).toBe(true);
    expect(Array.isArray(ANTIGRAVITY_AGENT_CAPABILITIES.supportedModels)).toBe(true);
  });

  it('declares readOnly correctly on tools', () => {
    const fileRead = ANTIGRAVITY_AGENT_CAPABILITIES.tools.find(t => t.id === 'file_read');
    const shell = ANTIGRAVITY_AGENT_CAPABILITIES.tools.find(t => t.id === 'shell');
    const grep = ANTIGRAVITY_AGENT_CAPABILITIES.tools.find(t => t.id === 'grep');
    const fileWrite = ANTIGRAVITY_AGENT_CAPABILITIES.tools.find(t => t.id === 'file_write');

    expect(fileRead?.readOnly).toBe(true);
    expect(grep?.readOnly).toBe(true);
    expect(shell?.readOnly).toBe(false);
    expect(fileWrite?.readOnly).toBe(false);
  });
});
