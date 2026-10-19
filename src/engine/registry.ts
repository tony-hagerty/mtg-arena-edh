import type { CardScript } from './types';

// Scripts register themselves here so rules.ts can look them up without importing
// scripts.ts (which itself imports rules.ts).
const SCRIPTS: Record<string, CardScript> = {};
const NONE: CardScript = {};
/** The names whose scripts have a static ability, so the layers can skip the rest quickly. */
const STATIC = new Set<string>();
/** The names whose scripts' static abilities can take abilities away (`CardScript.removesAbilities`). */
const REMOVING = new Set<string>();
/** For each trigger hook, the names whose scripts can give other permanents an ability on it (`CardScript.grants`). */
const GRANTED = new Map<string, Set<string>>();

export function registerScripts(scripts: Record<string, CardScript>) {
  Object.assign(SCRIPTS, scripts);
  for (const [name, s] of Object.entries(scripts)) {
    if (s.static) STATIC.add(name);
    else STATIC.delete(name);
    if (s.removesAbilities) REMOVING.add(name);
    else REMOVING.delete(name);
    for (const names of GRANTED.values()) names.delete(name);
    for (const { hook } of s.grants ?? []) {
      if (!GRANTED.has(hook)) GRANTED.set(hook, new Set());
      GRANTED.get(hook)!.add(name);
    }
  }
}

export const hasStaticScript = (name: string) => STATIC.has(name);
export const hasRemovingScript = (name: string) => REMOVING.has(name);
/** Can any script give a permanent a triggered ability on `hook`? */
export const anyGrantFor = (hook: string) => (GRANTED.get(hook)?.size ?? 0) > 0;
/** Can any script take abilities away? */
export const anyRemovingScript = () => REMOVING.size > 0;

export const scriptOf = (name: string): CardScript => SCRIPTS[name] ?? NONE;
export const hasScript = (name: string) => name in SCRIPTS;
