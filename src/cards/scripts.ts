// Card behaviour. A card with only printed keywords (Flying, Trample, ...) needs no entry;
// everything else does, and tests/cards.test.ts fails if one is missing.
//
// Triggered abilities (`onEnter`, `onCreatureDies`, ...) don't run on the spot: they go on
// the stack and run when they resolve. An ability that only triggers on some events must
// say which in `when`, or it would go on the stack for every one of them.
import { registerScripts } from '../engine/registry';
import {
  addCounters,
  allCreatures,
  createToken,
  creaturesOf,
  damageCard,
  damagePlayer,
  dealDamage,
  destroy,
  destroyMany,
  devotion,
  draw,
  exile,
  gainLife,
  hasType,
  isColor,
  isCreature,
  isPlaneswalker,
  isLand,
  loseLife,
  opponentsOf,
  permanent,
  pump,
  refCard,
  refPlayer,
  searchBasic,
  stats,
} from '../engine/rules';
import type { Card, CardScript, Ctx, Game, PlayerId, TargetSpec } from '../engine/types';

// ---------- target specs ----------

const creature = (label = 'target creature', filter?: TargetSpec['filter']): TargetSpec => ({ type: 'creature', label, filter });
const theirCreature: TargetSpec = { type: 'creature', who: 'opponent', label: "target creature you don't control" };
const yourCreature: TargetSpec = { type: 'creature', who: 'you', label: 'target creature you control' };
const anyTarget: TargetSpec = { type: 'any', label: 'any target' };
const anyPlayer: TargetSpec = { type: 'player', label: 'target player' };
const playerOrPlaneswalker: TargetSpec = { type: 'player or planeswalker', label: 'target player or planeswalker' };
const isArtifactOrEnchantment = (_g: Game, c: Card) => hasType(c, 'Artifact') || hasType(c, 'Enchantment');
const artifactOrEnchantment: TargetSpec = {
  type: 'permanent',
  label: 'target artifact or enchantment',
  filter: isArtifactOrEnchantment,
};

// ---------- reusable pieces ----------

const eachOpponentLoses = (g: Game, you: PlayerId, n: number) =>
  opponentsOf(g, you).reduce((total, o) => total + loseLife(g, o.id, n), 0);

const burn = (n: number): CardScript => ({
  targets: [anyTarget],
  onResolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], n),
});
const kill = (spec: TargetSpec): CardScript => ({
  targets: [spec],
  onResolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
});
const wrath: CardScript = { onResolve: (g) => destroyMany(g, allCreatures(g)) };
const firebreathing: CardScript = {
  activated: {
    cost: { mana: '{R}' },
    text: '{R}: +1/+0 until end of turn',
    resolve: (g, { self }) => pump(g, self, 1, 0),
  },
};
const drawAndLose = (cards: number, life: number) => (g: Game, { you }: Ctx) => {
  draw(g, you, cards);
  loseLife(g, you, life);
};
const isSpell = (c: Card) => hasType(c, 'Instant') || hasType(c, 'Sorcery');
// Trigger conditions shared by several cards.
const youCastASpell = (_g: Game, e: { self: Card; card: Card; caster: PlayerId }) => e.caster === e.self.owner && isSpell(e.card);
const yourLand = (_g: Game, e: { self: Card; land: Card }) => e.land.owner === e.self.owner;
const teamPump = (g: Game, you: PlayerId, power: number, toughness: number, keywords: string[] = []) => {
  for (const c of creaturesOf(g, you)) pump(g, c, power, toughness, keywords);
};

registerScripts({
  // ===== Shared artifacts =====
  'Sol Ring': { mana: { amount: 2, colors: ['C'] } },
  'Arcane Signet': { mana: { amount: 1, colors: 'identity' } },
  'Worn Powerstone': { entersTapped: true, mana: { amount: 2, colors: ['C'] } },
  'Thran Dynamo': { mana: { amount: 3, colors: ['C'] } },
  Manalith: { mana: { amount: 1, colors: 'any' } },
  'Solemn Simulacrum': {
    onEnter: (g, { you }) => void searchBasic(g, you, 'battlefield'),
    onDies: (g, { you }) => draw(g, you),
  },
  'Meteor Golem': {
    targets: [{ type: 'permanent', who: 'opponent', label: 'target nonland permanent an opponent controls', filter: (_g, c) => !isLand(c) }],
    onEnter: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },

  // ===== White =====
  'Lyra Dawnbringer': {
    static: (_g, self, c) =>
      c.id !== self.id && c.owner === self.owner && hasType(c, 'Angel') ? { power: 1, toughness: 1, keywords: ['lifelink'] } : null,
  },
  'Angel of Mercy': { onEnter: (g, { you }) => gainLife(g, you, 3) },
  'Archangel of Thune': {
    onLifeGain: {
      when: (_g, { self, player }) => player === self.owner,
      resolve: (g, { you }) => {
        for (const c of creaturesOf(g, you)) addCounters(g, c);
      },
    },
  },
  'Angel of the Dawn': { onEnter: (g, { you }) => teamPump(g, you, 1, 1, ['vigilance']) },
  'Inspiring Overseer': {
    onEnter: (g, { you }) => {
      gainLife(g, you, 1);
      draw(g, you);
    },
  },
  'Attended Knight': { onEnter: (g, { you }) => createToken(g, you, 'Soldier') },
  'Captain of the Watch': {
    static: (_g, self, c) =>
      c.id !== self.id && c.owner === self.owner && hasType(c, 'Soldier') ? { power: 1, toughness: 1, keywords: ['vigilance'] } : null,
    onEnter: (g, { you }) => createToken(g, you, 'Soldier', 3),
  },
  'Sunblast Angel': { onEnter: (g) => destroyMany(g, allCreatures(g).filter((c) => c.tapped)) },
  "Ajani's Pridemate": {
    onLifeGain: {
      when: (_g, { self, player }) => player === self.owner,
      resolve: (g, { self }) => addCounters(g, self),
    },
  },
  'Soul Warden': {
    onCreatureEnters: {
      when: (_g, { self, entered }) => entered.id !== self.id,
      resolve: (g, { you }) => gainLife(g, you, 1),
    },
  },
  'Benalish Marshal': {
    static: (_g, self, c) => (c.id !== self.id && c.owner === self.owner ? { power: 1, toughness: 1 } : null),
  },
  "Victory's Herald": {
    onAttack: (g) => {
      for (const a of g.combat?.attacks ?? []) pump(g, permanent(g, a.id), 0, 0, ['flying', 'lifelink']);
    },
  },
  'Swords to Plowshares': {
    targets: [creature()],
    onResolve: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (!c) return;
      const power = stats(g, c).power;
      exile(g, c);
      gainLife(g, c.owner, power);
    },
  },
  'Wrath of God': wrath,
  'Path to Exile': {
    targets: [creature()],
    onResolve: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (!c) return;
      exile(g, c);
      searchBasic(g, c.owner, 'battlefield');
    },
  },
  'Glorious Anthem': { static: (_g, self, c) => (c.owner === self.owner ? { power: 1, toughness: 1 } : null) },
  'Raise the Alarm': { onResolve: (g, { you }) => createToken(g, you, 'Soldier', 2) },
  Revitalize: {
    onResolve: (g, { you }) => {
      gainLife(g, you, 3);
      draw(g, you);
    },
  },
  Disenchant: kill(artifactOrEnchantment),
  'Divine Verdict': kill(
    creature('target attacking or blocking creature', (g, c) =>
      (g.combat?.attacks ?? []).some((a) => a.id === c.id || a.blockers.includes(c.id)),
    ),
  ),
  'Inspired Charge': { onResolve: (g, { you }) => teamPump(g, you, 2, 1) },

  // ===== Black =====
  'Sheoldred, the Apocalypse': {
    onDraw: (g, { self, player }) => {
      if (player === self.owner) gainLife(g, player, 2);
      else loseLife(g, player, 2);
    },
  },
  'Gray Merchant of Asphodel': {
    onEnter: (g, { you }) => gainLife(g, you, eachOpponentLoses(g, you, devotion(g, you, 'B'))),
  },
  'Harvester of Souls': {
    onCreatureDies: {
      when: (_g, { self, dead }) => dead.id !== self.id && !dead.isToken,
      resolve: (g, { you }) => draw(g, you),
    },
  },
  'Zulaport Cutthroat': {
    onCreatureDies: {
      when: (_g, { self, dead }) => dead.owner === self.owner,
      resolve: (g, { you }) => {
        eachOpponentLoses(g, you, 1);
        gainLife(g, you, 1);
      },
    },
  },
  'Ravenous Chupacabra': {
    targets: [{ type: 'creature', who: 'opponent', label: 'target creature an opponent controls' }],
    onEnter: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  Nekrataal: {
    targets: [creature('target nonartifact, nonblack creature', (_g, c) => !hasType(c, 'Artifact') && !isColor(c, 'B'))],
    onEnter: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  'Nantuko Shade': {
    activated: {
      cost: { mana: '{B}' },
      text: '{B}: +1/+1 until end of turn',
      resolve: (g, { self }) => pump(g, self, 1, 1),
    },
  },
  'Kokusho, the Evening Star': { onDies: (g, { you }) => gainLife(g, you, eachOpponentLoses(g, you, 5)) },
  'Massacre Wurm': {
    onEnter: (g, { you }) => {
      for (const o of opponentsOf(g, you)) for (const c of creaturesOf(g, o.id)) pump(g, c, -2, -2);
    },
    onCreatureDies: {
      when: (_g, { self, dead }) => dead.owner !== self.owner,
      resolve: (g, { dead }) => void loseLife(g, dead.owner, 2),
    },
  },
  'Vampire Sovereign': {
    targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
    onEnter: (g, { you, targets }) => {
      const p = refPlayer(g, targets[0]);
      if (!p) return;
      loseLife(g, p.id, 3);
      gainLife(g, you, 3);
    },
  },
  'Dusk Legion Zealot': { onEnter: drawAndLose(1, 1) },
  'Phyrexian Rager': { onEnter: drawAndLose(1, 1) },
  'Grave Titan': {
    onEnter: (g, { you }) => createToken(g, you, 'Zombie', 2),
    onAttack: (g, { self }) => createToken(g, self.owner, 'Zombie', 2),
  },
  Nightmare: {
    basePT: (g, self) => {
      const swamps = g.players[self.owner].battlefield.filter((c) => hasType(c, 'Swamp')).length;
      return { power: swamps, toughness: swamps };
    },
  },
  'Doom Blade': kill(creature('target nonblack creature', (_g, c) => !isColor(c, 'B'))),
  Murder: kill(creature()),
  'Go for the Throat': kill(creature('target nonartifact creature', (_g, c) => !hasType(c, 'Artifact'))),
  "Hero's Downfall": kill({ type: 'creature or planeswalker', label: 'target creature or planeswalker' }),
  'Sign in Blood': {
    targets: [anyPlayer],
    onResolve: (g, { targets }) => {
      const p = refPlayer(g, targets[0]);
      if (!p) return;
      draw(g, p.id, 2);
      loseLife(g, p.id, 2);
    },
  },
  "Night's Whisper": { onResolve: drawAndLose(2, 2) },
  Damnation: wrath,
  'Syphon Soul': {
    onResolve: (g, { self, you }) =>
      gainLife(
        g,
        you,
        opponentsOf(g, you).reduce((n, o) => n + damagePlayer(g, self, o.id, 2), 0),
      ),
  },
  'Phyrexian Arena': {
    onUpkeep: {
      when: (_g, { self, player }) => player === self.owner,
      resolve: (g, { you }) => {
        draw(g, you);
        loseLife(g, you, 1);
      },
    },
  },

  // ===== Red =====
  'Torbran, Thane of Red Fell': {
    damageBonus: (_g, self, source, targetOwner) => (isColor(source, 'R') && targetOwner !== self.owner ? 2 : 0),
  },
  'Goblin Chainwhirler': {
    onEnter: (g, { self, you }) => {
      for (const o of opponentsOf(g, you)) {
        damagePlayer(g, self, o.id, 1);
        for (const c of o.battlefield.filter((x) => isCreature(x) || isPlaneswalker(x))) damageCard(g, self, c, 1);
      }
    },
  },
  'Beetleback Chief': { onEnter: (g, { you }) => createToken(g, you, 'Goblin', 2) },
  'Shivan Dragon': firebreathing,
  'Furnace Whelp': firebreathing,
  'Thundermaw Hellkite': {
    onEnter: (g, { self, you }) => {
      for (const o of opponentsOf(g, you)) {
        for (const c of creaturesOf(g, o.id)) {
          if (!stats(g, c).keywords.has('flying')) continue;
          damageCard(g, self, c, 1);
          c.tapped = true;
        }
      }
    },
  },
  'Flametongue Kavu': {
    targets: [creature()],
    onEnter: (g, { self, targets }) => void dealDamage(g, self, targets[0], 4),
  },
  'Borderland Marauder': { onAttack: (g, { self }) => pump(g, self, 2, 0) },
  Guttersnipe: {
    onCast: {
      when: youCastASpell,
      resolve: (g, { self, you }) => {
        for (const o of opponentsOf(g, you)) damagePlayer(g, self, o.id, 2);
      },
    },
  },
  'Thermo-Alchemist': {
    activated: {
      cost: { tap: true },
      text: '{T}: 1 damage to each opponent',
      resolve: (g, { self, you }) => {
        for (const o of opponentsOf(g, you)) damagePlayer(g, self, o.id, 1);
      },
    },
    onCast: {
      when: youCastASpell,
      resolve: (_g, { self }) => {
        self.tapped = false;
      },
    },
  },
  Hellrider: {
    onCreatureAttacks: {
      when: (_g, { self, attacker }) => attacker.owner === self.owner,
      // The player or planeswalker it's attacking (508.5). A battle it attacks doesn't count.
      resolve: (g, { self, defender, target }) => {
        const attacked = target ? permanent(g, target) : undefined;
        if (!target) damagePlayer(g, self, defender, 1);
        else if (attacked && isPlaneswalker(attacked)) dealDamage(g, self, { kind: 'card', id: attacked.id }, 1);
      },
    },
  },
  'Viashino Pyromancer': {
    targets: [playerOrPlaneswalker],
    onEnter: (g, { self, targets }) => void dealDamage(g, self, targets[0], 2),
  },
  'Balefire Dragon': {
    onCombatDamageToPlayer: (g, { self, player, amount }) => {
      for (const c of creaturesOf(g, player)) damageCard(g, self, c, amount);
    },
  },
  'Mogg Fanatic': {
    activated: {
      cost: { sacrifice: true },
      targets: [anyTarget],
      text: 'Sacrifice: 1 damage to any target',
      resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 1),
    },
  },
  'Lightning Bolt': burn(3),
  Shock: burn(2),
  'Lightning Strike': burn(3),
  'Lava Axe': { targets: [playerOrPlaneswalker], onResolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 5) },
  'Flame Rift': {
    onResolve: (g, { self }) => {
      for (const p of g.players) damagePlayer(g, self, p.id, 4);
    },
  },
  Pyroclasm: {
    onResolve: (g, { self }) => {
      for (const c of allCreatures(g)) damageCard(g, self, c, 2);
    },
  },
  'Blasphemous Act': {
    costReduction: (g) => allCreatures(g).length,
    onResolve: (g, { self }) => {
      for (const c of allCreatures(g)) damageCard(g, self, c, 13);
    },
  },
  Shatter: kill({ type: 'permanent', label: 'target artifact', filter: (_g, c) => hasType(c, 'Artifact') }),
  Fervor: { static: (_g, self, c) => (c.owner === self.owner ? { keywords: ['haste'] } : null) },
  'Brute Strength': {
    targets: [creature()],
    onResolve: (g, { targets }) => pump(g, refCard(g, targets[0]), 3, 1, ['trample']),
  },

  // ===== Green =====
  'Ghalta, Primal Hunger': {
    costReduction: (g, self) => creaturesOf(g, self.owner).reduce((n, c) => n + Math.max(0, stats(g, c).power), 0),
  },
  'Llanowar Elves': { mana: { amount: 1, colors: ['G'] } },
  'Elvish Mystic': { mana: { amount: 1, colors: ['G'] } },
  'Rampaging Baloths': {
    onLandfall: { when: yourLand, resolve: (g, { you }) => createToken(g, you, 'Beast 4/4') },
  },
  // "Can't be countered" is always true here: the card pool has no counterspells.
  'Terra Stomper': {},
  'Carnage Tyrant': {},
  'Acidic Slime': {
    targets: [
      {
        type: 'permanent',
        label: 'target artifact, enchantment, or land',
        filter: (g, c) => isArtifactOrEnchantment(g, c) || isLand(c),
      },
    ],
    onEnter: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  'Reclamation Sage': {
    targets: [{ ...artifactOrEnchantment, optional: true }],
    onEnter: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  'Wood Elves': { onEnter: (g, { you }) => void searchBasic(g, you, 'battlefield', { tapped: false, subtype: 'Forest' }) },
  'Farhaven Elf': { onEnter: (g, { you }) => void searchBasic(g, you, 'battlefield') },
  'Thrashing Brontodon': {
    activated: {
      cost: { mana: '{1}', sacrifice: true },
      targets: [artifactOrEnchantment],
      text: '{1}, Sacrifice: destroy target artifact or enchantment',
      resolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
    },
  },
  'Pelakka Wurm': {
    onEnter: (g, { you }) => gainLife(g, you, 7),
    onDies: (g, { you }) => draw(g, you),
  },
  'Avenger of Zendikar': {
    onEnter: (g, { you }) => createToken(g, you, 'Plant', g.players[you].battlefield.filter(isLand).length),
    onLandfall: {
      when: yourLand,
      resolve: (g, { you }) => {
        for (const c of creaturesOf(g, you)) if (hasType(c, 'Plant')) addCounters(g, c);
      },
    },
  },
  'Elvish Visionary': { onEnter: (g, { you }) => draw(g, you) },
  'Beast Whisperer': {
    onCast: {
      when: (_g, { self, card, caster }) => caster === self.owner && isCreature(card),
      resolve: (g, { you }) => draw(g, you),
    },
  },
  "Garruk's Packleader": {
    onCreatureEnters: {
      when: (g, { self, entered }) => entered.id !== self.id && entered.owner === self.owner && stats(g, entered).power >= 3,
      resolve: (g, { you }) => draw(g, you),
    },
  },
  'Rampant Growth': { onResolve: (g, { you }) => void searchBasic(g, you, 'battlefield') },
  Cultivate: {
    onResolve: (g, { you }) => {
      searchBasic(g, you, 'battlefield');
      searchBasic(g, you, 'hand');
    },
  },
  'Giant Growth': { targets: [creature()], onResolve: (g, { targets }) => pump(g, refCard(g, targets[0]), 3, 3) },
  Overrun: { ai: 'alpha', onResolve: (g, { you }) => teamPump(g, you, 3, 3, ['trample']) },
  'Rabid Bite': {
    targets: [yourCreature, theirCreature],
    onResolve: (g, { targets }) => {
      const mine = refCard(g, targets[0]);
      const theirs = refCard(g, targets[1]);
      if (mine && theirs) dealDamage(g, mine, targets[1], stats(g, mine).power);
    },
  },
  Harmonize: { onResolve: (g, { you }) => draw(g, you, 3) },
  'Beast Within': {
    targets: [{ type: 'permanent', label: 'target permanent' }],
    onResolve: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (!c) return;
      destroy(g, c);
      createToken(g, c.owner, 'Beast 3/3');
    },
  },

  // ---------- predefined tokens (111.10) ----------
  Treasure: { mana: { amount: 1, colors: 'any', sacrifice: true } },
  Food: {
    activated: { cost: { mana: '{2}', tap: true, sacrifice: true }, text: '{2}, {T}, Sacrifice: You gain 3 life', resolve: (g, { you }) => gainLife(g, you, 3) },
  },
  Clue: {
    activated: { cost: { mana: '{2}', sacrifice: true }, text: '{2}, Sacrifice: Draw a card', resolve: (g, { you }) => draw(g, you, 1) },
  },
});
