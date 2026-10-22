import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Writes JSON under public/research (or another public/ subfolder), rounding floats to keep files small. */
export function writeJson(rel: string, data: unknown): string {
  const file = path.join(ROOT, 'public', rel);
  mkdirSync(path.dirname(file), { recursive: true });
  const json = JSON.stringify(
    data,
    (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v),
    1,
  );
  writeFileSync(file, json + '\n');
  return file;
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export function numArg(name: string, fallback: number): number {
  const v = arg(name);
  return v === undefined ? fallback : Number(v);
}
