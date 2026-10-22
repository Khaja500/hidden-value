/**
 * localStorage, wrapped so the site still works when it is unavailable (private windows, blocked storage):
 * reads fall back to an in-memory copy and failed writes are ignored.
 */
const memory = new Map<string, string>();
const PREFIX = 'hidden-value:';

function backend(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = `${PREFIX}probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function load<T>(key: string, fallback: T): T {
  let raw: string | null | undefined;
  try {
    raw = backend()?.getItem(PREFIX + key);
  } catch {
    raw = null;
  }
  if (raw == null) raw = memory.get(key) ?? null;
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    backend()?.setItem(PREFIX + key, raw);
  } catch {
    // Quota exceeded or storage blocked: the in-memory copy still works for this session.
  }
}

export function remove(key: string): void {
  memory.delete(key);
  try {
    backend()?.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
