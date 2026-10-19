import type { CardScript } from './types';

// Scripts register themselves here so rules.ts can look them up without importing
// scripts.ts (which itself imports rules.ts).
const SCRIPTS: Record<string, CardScript> = {};
/** The empty script: a card that does only what its printed keywords say. */
export const NO_SCRIPT: CardScript = {};
const NONE = NO_SCRIPT;
/** The names whose scripts have a static ability, so the layers can skip the rest quickly. */
const STATIC = new Set<string>();
/** The names whose scripts' static abilities can take abilities away (`CardScript.removesAbilities`). */
const REMOVING = new Set<string>();

export function registerScripts(scripts: Record<string, CardScript>) {
  Object.assign(SCRIPTS, scripts);
  for (const [name, s] of Object.entries(scripts)) {
    if (s.static) STATIC.add(name);
    else STATIC.delete(name);
    if (s.removesAbilities) REMOVING.add(name);
    else REMOVING.delete(name);
  }
}

export const hasStaticScript = (name: string) => STATIC.has(name);
export const hasRemovingScript = (name: string) => REMOVING.has(name);
/** Can any script take abilities away? */
export const anyRemovingScript = () => REMOVING.size > 0;

export const scriptOf = (name: string): CardScript => SCRIPTS[name] ?? NONE;
export const hasScript = (name: string) => name in SCRIPTS;
