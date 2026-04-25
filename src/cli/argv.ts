import { parseArgs } from 'node:util';

export type KaytooOutputMode = 'chat' | 'console';

export type ParsedKaytooArgv = {
  /** When set, overrides `KAYTOO_OUTPUT` in `getConfig`. */
  outputOverride?: KaytooOutputMode;
};

export function parseKaytooArgv(argv: string[] = process.argv): ParsedKaytooArgv {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      output: { type: 'string' },
    },
    strict: false,
  });

  const raw = values.output;
  if (raw == null || raw === '') return {};

  const o = String(raw).trim().toLowerCase();
  if (o === 'console') return { outputOverride: 'console' };
  if (o === 'chat') return { outputOverride: 'chat' };
  throw new Error(`Invalid --output=${raw}; use chat or console`);
}
