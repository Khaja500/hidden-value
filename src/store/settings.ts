/** User settings, persisted with the safe storage wrapper. */
import { create } from 'zustand';
import type { Difficulty } from '../engine/types';
import { load, save } from './storage';

export type Theme = 'system' | 'light' | 'dark';
export type Pacing = 'turn' | 'timed';

export interface Settings {
  theme: Theme;
  difficulty: Difficulty;
  pacing: Pacing;
  /** Seconds per step in timed mode. */
  stepSeconds: number;
  tutorialDone: boolean;
}

const DEFAULTS: Settings = {
  theme: 'system',
  difficulty: 'medium',
  pacing: 'turn',
  stepSeconds: 8,
  tutorialDone: false,
};

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULTS,
  ...load<Partial<Settings>>('settings', {}),
  update: (patch) => {
    set(patch);
    const { update: _u, ...rest } = { ...get() };
    save('settings', rest);
  },
}));

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
