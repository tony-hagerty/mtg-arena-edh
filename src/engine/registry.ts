import type { CardScript } from './types';

// Scripts register themselves here so rules.ts can look them up without importing
// scripts.ts (which itself imports rules.ts).
const SCRIPTS: Record<string, CardScript> = {};
const NONE: CardScript = {};

export function registerScripts(scripts: Record<string, CardScript>) {
  Object.assign(SCRIPTS, scripts);
}

export const scriptOf = (name: string): CardScript => SCRIPTS[name] ?? NONE;
export const hasScript = (name: string) => name in SCRIPTS;
