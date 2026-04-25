import { describe, expect, it } from 'vitest';
import { parseKaytooArgv } from '../src/cli/argv.js';

describe('parseKaytooArgv', () => {
  it('returns empty when --output omitted', () => {
    expect(parseKaytooArgv(['node', 'main.js'])).toEqual({});
    expect(parseKaytooArgv(['node', 'main.js', '--foo', 'bar'])).toEqual({});
  });

  it('parses --output console', () => {
    expect(parseKaytooArgv(['node', 'main.js', '--output', 'console'])).toEqual({ outputOverride: 'console' });
    expect(parseKaytooArgv(['node', 'main.js', '--output=console'])).toEqual({ outputOverride: 'console' });
    expect(parseKaytooArgv(['node', 'main.js', '--output', 'CONSOLE'])).toEqual({ outputOverride: 'console' });
  });

  it('parses --output chat', () => {
    expect(parseKaytooArgv(['node', 'main.js', '--output', 'chat'])).toEqual({ outputOverride: 'chat' });
    expect(parseKaytooArgv(['node', 'main.js', '--output=chat'])).toEqual({ outputOverride: 'chat' });
  });

  it('throws on invalid --output', () => {
    expect(() => parseKaytooArgv(['node', 'main.js', '--output', 'irc'])).toThrow(/Invalid --output/);
  });
});
