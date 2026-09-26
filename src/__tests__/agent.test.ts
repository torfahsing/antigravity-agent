import { describe, it, expect } from 'bun:test';
import type { AgentEvent } from '../agent.js';

describe('antigravity-agent step update parsing', () => {
  it('parses tool_call and tool_result step updates correctly', () => {
    const events: AgentEvent[] = [];
    const onEvent = (ev: AgentEvent) => events.push(ev);

    const activeToolEvent = {
      event: 'step_update',
      step_update: {
        step_index: 2,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: {
          name: 'run_command',
          parameters: { CommandLine: 'ls -la' },
        },
      },
    };

    const doneToolEvent = {
      event: 'step_update',
      step_update: {
        step_index: 2,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: {
          name: 'run_command',
          output: 'file1.txt\nfile2.txt',
        },
      },
    };

    // Simulate event handler logic
    for (const ev of [activeToolEvent, doneToolEvent]) {
      const su = ev.step_update;
      if (ev.event === 'step_update' && su) {
        if (su.step_type === 'tool') {
          const toolName = su.tool_name || su.tool_info?.name || 'tool';
          const callId = String(su.step_index ?? Date.now());
          if (su.state === 'ACTIVE') {
            onEvent({
              type: 'tool_call',
              name: toolName,
              callId,
              args: (su.tool_info?.parameters as Record<string, unknown>) ?? {},
            });
          } else if (su.state === 'DONE') {
            const output = typeof su.tool_info?.output === 'string'
              ? su.tool_info.output
              : JSON.stringify(su.tool_info?.output ?? '');
            onEvent({
              type: 'tool_result',
              name: toolName,
              callId,
              output,
            });
          }
        }
      }
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'tool_call',
      name: 'run_command',
      callId: '2',
      args: { CommandLine: 'ls -la' },
    });
    expect(events[1]).toEqual({
      type: 'tool_result',
      name: 'run_command',
      callId: '2',
      output: 'file1.txt\nfile2.txt',
    });
  });
});
