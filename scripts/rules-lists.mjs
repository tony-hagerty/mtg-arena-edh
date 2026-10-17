// Lists read out of the Comprehensive Rules' text by fetch-rules.mjs: creature types and
// the other card types' subtypes (205.3).

/** The creature types listed in rule 205.3m: "... one word long: Advisor, ..., and Zubera." plus any two-word ones before it. */
export function creatureTypesOf(line) {
  const twoWord = [...line.matchAll(/two words long: ([^.]+)\./g)].flatMap((m) => m[1].split(/, | and /));
  const oneWord = line.split('one word long: ')[1].replace(/\.$/, '').split(/, (?:and )?/);
  return [...new Set([...twoWord, ...oneWord].map((t) => t.trim()).filter(Boolean))].sort();
}

/** Rules 205.3g-q other than creature (205.3m) and planar (205.3n) types: the card types each list goes with. */
const LISTS = {
  '205.3g': ['Artifact'],
  '205.3h': ['Enchantment'],
  '205.3i': ['Land'],
  '205.3j': ['Planeswalker'],
  '205.3k': ['Instant', 'Sorcery'],
  '205.3p': ['Dungeon'],
  '205.3q': ['Battle'],
};

/**
 * Each card type's subtypes, by card type: "The artifact types are Attraction (see rule 717),
 * Blood, ..., and Vibranium." Curly apostrophes become straight ones, as card type lines have them.
 */
export function subtypeListsOf(lines) {
  const out = {};
  for (const [num, types] of Object.entries(LISTS)) {
    const line = lines.find((l) => l.startsWith(`${num} `));
    const list = line?.match(/(?:The [\w ]+ types are|That [\w ]+ type is) (.+?)\.(?: |$)/)?.[1];
    if (!list) throw new Error(`Rule ${num} (subtypes) not found or not recognised`);
    const subtypes = list
      .replace(/ \(see rule [\d.]+\)/g, '')
      .split(/, (?:and )?| and /)
      .map((t) => t.trim().replaceAll('’', "'"))
      .filter(Boolean);
    for (const t of types) out[t] = subtypes;
  }
  return out;
}
