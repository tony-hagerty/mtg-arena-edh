import type { CardScript } from './types';

// Scripts register themselves here so rules.ts can look them up without importing
// scripts.ts (which itself imports rules.ts).
const SCRIPTS: Record<string, CardScript> = {};
const NONE: CardScript = {};
/** The names whose scripts have a static ability, so the layers can skip the rest quickly. */
const STATIC = new Set<string>();

export function registerScripts(scripts: Record<string, CardScript>) {
  Object.assign(SCRIPTS, scripts);
  for (const [name, s] of Object.entries(scripts)) {
    if (s.static) STATIC.add(name);
    else STATIC.delete(name);
  }
}

export const hasStaticScript = (name: string) => STATIC.has(name);

export const scriptOf = (name: string): CardScript => SCRIPTS[name] ?? NONE;
export const hasScript = (name: string) => name in SCRIPTS;
