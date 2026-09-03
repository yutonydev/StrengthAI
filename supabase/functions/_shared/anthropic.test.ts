import { describe, it, expect } from 'vitest';
import { anthropicHeaders } from './anthropic.ts';

/**
 * These exist for the same reason usage.test.ts does: this logic sits directly in front of
 * every billable model call, and when it is wrong the app fails soft — so nothing on screen
 * tells you, and only the edge-function logs do.
 */

describe('anthropicHeaders', () => {
  it('always sends the three headers the API requires', () => {
    const h = anthropicHeaders('sk-test');
    expect(h['content-type']).toBe('application/json');
    expect(h['x-api-key']).toBe('sk-test');
    expect(h['anthropic-version']).toBe('2023-06-01');
  });

  it('omits the workspace header when there is no workspace id', () => {
    // A workspace-scoped key already knows where it acts. Sending an empty
    // `anthropic-workspace-id` would break a setup that previously worked.
    expect('anthropic-workspace-id' in anthropicHeaders('sk-test')).toBe(false);
    expect('anthropic-workspace-id' in anthropicHeaders('sk-test', undefined)).toBe(false);
    expect('anthropic-workspace-id' in anthropicHeaders('sk-test', null)).toBe(false);
  });

  it('sends the workspace header when one is configured', () => {
    // An identity-linked key is refused with a 400 without this.
    const h = anthropicHeaders('sk-test', 'wrkspc_abc123');
    expect(h['anthropic-workspace-id']).toBe('wrkspc_abc123');
  });

  it('treats a blank or whitespace-only workspace id as unset', () => {
    // A cleared secret, or one saved with a trailing newline from a copy-paste. Sending the
    // header with an empty value is worse than not sending it: the key type that does not
    // need it starts failing, for a reason the error message does not make obvious.
    expect('anthropic-workspace-id' in anthropicHeaders('sk-test', '')).toBe(false);
    expect('anthropic-workspace-id' in anthropicHeaders('sk-test', '   ')).toBe(false);
    expect('anthropic-workspace-id' in anthropicHeaders('sk-test', '\n')).toBe(false);
  });

  it('trims a workspace id rather than sending it verbatim', () => {
    expect(anthropicHeaders('sk-test', '  wrkspc_abc123\n')['anthropic-workspace-id'])
      .toBe('wrkspc_abc123');
  });

  it('never yields undefined for the key header', () => {
    // The backfill path used `Deno.env.get(...) ?? ''`; keeping that behaviour means a
    // missing secret produces an honest 401 from the API rather than a header of the
    // literal string "undefined".
    expect(anthropicHeaders(undefined as unknown as string)['x-api-key']).toBe('');
  });
});
