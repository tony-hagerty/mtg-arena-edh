// Card behaviour. A card with only printed keywords (Flying, Trample, ...) needs no entry;
// everything else does, and tests/cards.test.ts fails if one is missing.
//
// Triggered abilities (`onEnter`, `onCreatureDies`, ...) don't run on the spot: they go on
// the stack and run when they resolve. An ability that only triggers on some events must
// say which in `when`, or it would go on the stack for every one of them.
import { registerScripts } from '../engine/registry';
import {
  addCounters,
  addEffect,
  addMana,
  allCreatures,
  ask,
  battlefield,
  bounce,
  choosePlayer,
  chooseToDiscard,
  counter,
  createToken,
  creaturesOf,
  damageCard,
  damagePlayer,
  dealDamage,
  delay,
  destroy,
  destroyMany,
  devotion,
  discard,
  draw,
  enterBattlefield,
  exile,
  gainLife,
  hasType,
  isColor,
  isCreature,
  isLand,
  isPlaneswalker,
  label,
  log,
  loseLife,
  manaValue,
  mill,
  moveCard,
  opponentsOf,
  permanent,
  pickCards,
  prowess,
  pump,
  putOnTop,
  refCard,
  refGraveyard,
  refPlayer,
  refStack,
  sameCard,
  says,
  search,
  searchBasic,
  stats,
  subtypesOf,
  tap,
  turnOrder,
  simultaneously,
} from '../engine/rules';
import type { Card, CardScript, Ctx, Game, ManaSym, PlayerId, TargetSpec } from '../engine/types';

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

/** "Each opponent loses N life", all at once (one event): returns the total actually lost. */
const eachOpponentLoses = (g: Game, you: PlayerId, n: number) => {
  let total = 0;
  simultaneously(g, () => opponentsOf(g, you).forEach((o) => (total += loseLife(g, o.id, n))));
  return total;
};

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
const youCastASpell = (_g: Game, e: { self: Card; card: Card; caster: PlayerId }) => e.caster === e.self.controller && isSpell(e.card);
const yourLand = (_g: Game, e: { self: Card; land: Card }) => e.land.controller === e.self.controller;
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
      c.id !== self.id && c.controller === self.controller && hasType(c, 'Angel') ? { power: 1, toughness: 1, keywords: ['lifelink'] } : null,
  },
  'Angel of Mercy': { onEnter: (g, { you }) => gainLife(g, you, 3) },
  'Archangel of Thune': {
    onLifeGain: {
      when: (_g, { self, player }) => player === self.controller,
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
      c.id !== self.id && c.controller === self.controller && hasType(c, 'Soldier') ? { power: 1, toughness: 1, keywords: ['vigilance'] } : null,
    onEnter: (g, { you }) => createToken(g, you, 'Soldier', 3),
  },
  'Sunblast Angel': { onEnter: (g) => destroyMany(g, allCreatures(g).filter((c) => c.tapped)) },
  "Ajani's Pridemate": {
    onLifeGain: {
      when: (_g, { self, player }) => player === self.controller,
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
    static: (_g, self, c) => (c.id !== self.id && c.controller === self.controller ? { power: 1, toughness: 1 } : null),
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
      // "Its controller gains life equal to its power": as it last was on the battlefield.
      const { power } = stats(g, c);
      const controller = c.controller;
      exile(g, c);
      gainLife(g, controller, power);
    },
  },
  'Wrath of God': wrath,
  'Path to Exile': {
    targets: [creature()],
    onResolve: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (!c) return;
      const controller = c.controller;
      exile(g, c);
      searchBasic(g, controller, 'battlefield');
    },
  },
  'Glorious Anthem': { static: (_g, self, c) => (c.controller === self.controller ? { power: 1, toughness: 1 } : null) },
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
      if (player === self.controller) gainLife(g, player, 2);
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
      when: (_g, { self, dead }) => dead.controller === self.controller,
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
      when: (_g, { self, dead }) => dead.controller !== self.controller,
      resolve: (g, { dead }) => void loseLife(g, dead.controller, 2),
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
    onAttack: (g, { self }) => createToken(g, self.controller, 'Zombie', 2),
  },
  Nightmare: {
    basePT: (g, self) => {
      const swamps = g.players[self.controller].battlefield.filter((c) => hasType(c, 'Swamp')).length;
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
    onResolve: (g, { self, you }) => {
      let dealt = 0;
      simultaneously(g, () => opponentsOf(g, you).forEach((o) => (dealt += damagePlayer(g, self, o.id, 2))));
      gainLife(g, you, dealt);
    },
  },
  'Phyrexian Arena': {
    onUpkeep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => {
        draw(g, you);
        loseLife(g, you, 1);
      },
    },
  },

  // ===== Red =====
  'Torbran, Thane of Red Fell': {
    // "If a red source you control would deal damage to an opponent or a permanent an opponent
    // controls, it deals that much damage plus 2 instead." (614.1a)
    changesDamage: (_g, self, source, to) =>
      source.controller === self.controller && isColor(source, 'R') && (to.player ?? to.card!.controller) !== self.controller ? { plus: 2 } : null,
  },
  'Goblin Chainwhirler': {
    onEnter: (g, { self, you }) =>
      simultaneously(g, () => {
        for (const o of opponentsOf(g, you)) {
          damagePlayer(g, self, o.id, 1);
          for (const c of o.battlefield.filter((x) => isCreature(x) || isPlaneswalker(x))) damageCard(g, self, c, 1);
        }
      }),
  },
  'Beetleback Chief': { onEnter: (g, { you }) => createToken(g, you, 'Goblin', 2) },
  'Shivan Dragon': firebreathing,
  'Furnace Whelp': firebreathing,
  'Thundermaw Hellkite': {
    // "It deals 1 damage to each creature with flying your opponents control. Tap those creatures."
    onEnter: (g, { self, you }) => {
      const fliers = opponentsOf(g, you).flatMap((o) => creaturesOf(g, o.id).filter((c) => stats(g, c).keywords.has('flying')));
      simultaneously(g, () => fliers.forEach((c) => void damageCard(g, self, c, 1)));
      for (const c of fliers) if (c.zone === 'battlefield') tap(g, c);
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
      resolve: (g, { self, you }) => simultaneously(g, () => opponentsOf(g, you).forEach((o) => void damagePlayer(g, self, o.id, 2))),
    },
  },
  'Thermo-Alchemist': {
    activated: {
      cost: { tap: true },
      text: '{T}: 1 damage to each opponent',
      resolve: (g, { self, you }) => simultaneously(g, () => opponentsOf(g, you).forEach((o) => void damagePlayer(g, self, o.id, 1))),
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
      when: (_g, { self, attacker }) => attacker.controller === self.controller,
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
    onCombatDamageToPlayer: (g, { self, player, amount }) => simultaneously(g, () => creaturesOf(g, player).forEach((c) => void damageCard(g, self, c, amount))),
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
      simultaneously(g, () => g.players.forEach((p) => void damagePlayer(g, self, p.id, 4)));
    },
  },
  Pyroclasm: {
    onResolve: (g, { self }) => simultaneously(g, () => allCreatures(g).forEach((c) => void damageCard(g, self, c, 2))),
  },
  'Blasphemous Act': {
    costReduction: (g) => allCreatures(g).length,
    onResolve: (g, { self }) => simultaneously(g, () => allCreatures(g).forEach((c) => void damageCard(g, self, c, 13))),
  },
  Shatter: kill({ type: 'permanent', label: 'target artifact', filter: (_g, c) => hasType(c, 'Artifact') }),
  Fervor: { static: (_g, self, c) => (c.controller === self.controller ? { keywords: ['haste'] } : null) },
  'Brute Strength': {
    targets: [creature()],
    onResolve: (g, { targets }) => pump(g, refCard(g, targets[0]), 3, 1, ['trample']),
  },

  // ===== Green =====
  'Ghalta, Primal Hunger': {
    costReduction: (g, self) => creaturesOf(g, self.controller).reduce((n, c) => n + Math.max(0, stats(g, c).power), 0),
  },
  'Llanowar Elves': { mana: { amount: 1, colors: ['G'] } },
  'Elvish Mystic': { mana: { amount: 1, colors: ['G'] } },
  'Rampaging Baloths': {
    onLandfall: { when: yourLand, resolve: (g, { you }) => createToken(g, you, 'Beast 4/4') },
  },
  'Terra Stomper': { uncounterable: true },
  'Carnage Tyrant': { uncounterable: true },
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
      when: (_g, { self, card, caster }) => caster === self.controller && isCreature(card),
      resolve: (g, { you }) => draw(g, you),
    },
  },
  "Garruk's Packleader": {
    onCreatureEnters: {
      when: (g, { self, entered }) => entered.id !== self.id && entered.controller === self.controller && stats(g, entered).power >= 3,
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
      const controller = c.controller;
      destroy(g, c);
      createToken(g, controller, 'Beast 3/3');
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

// ---------- requested cards ----------
// Cards players asked for (docs/card-requests.json) whose wording the Oracle text parser
// doesn't read. Each follows its Oracle text clause by clause (docs/card-scripting.md).

const anySpell: TargetSpec = { type: 'spell', label: 'target spell' };
const controls = (g: Game, pid: PlayerId, type: string) => g.players[pid].battlefield.some((c) => hasType(c, type));
const landCount = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter(isLand).length;
const yourTurnStep = (_g: Game, e: { self: Card; player: PlayerId }) => e.player === e.self.controller;
const isOpponent = (g: Game, a: PlayerId, b: PlayerId) => a !== b && !g.players[b].lost;
const graveyardCard = (label: string, filter: (c: Card) => boolean, who?: TargetSpec['who']): TargetSpec => ({
  type: 'graveyard card',
  label,
  ...(who ? { who } : {}),
  filter: (_g, c) => filter(c),
});

/** The permanent an ability's source still is, if it hasn't left the battlefield (400.7). */
const stillThere = (g: Game, self: Card) => {
  const c = permanent(g, self.id);
  return sameCard(c, self) ? c : undefined;
};

/** "Exile [it], then return it to the battlefield under its owner's control": a new object (400.7). A token stays in exile and ceases to exist (111.8). */
function flicker(g: Game, c: Card | undefined) {
  if (!c) return;
  exile(g, c);
  if (c.zone === 'exile' && !c.isToken) enterBattlefield(g, c, { controller: c.owner });
}

/** "You may draw [N] cards", asked of the player. */
const mayDraw = (g: Game, you: PlayerId, n: number) => ask(g, you, { text: `Draw ${n === 1 ? 'a card' : `${n} cards`}?`, yes: 'Draw', no: "Don't Draw", then: 'mayDraw', data: { n } });
const mayDrawThen: NonNullable<CardScript['then']> = { mayDraw: (g, { you, yes, data }) => yes && draw(g, you, data.n as number) };
/** Bots draw unless that would leave them nearly decked. */
const botDraws = { mayDraw: (g: Game, pid: PlayerId) => ({ type: 'answer' as const, yes: g.players[pid].library.length > 5 }) };

/** "Untap up to three lands": any lands on the battlefield, chosen as it resolves. */
const untapLands = (g: Game, you: PlayerId, n: number) => {
  const tapped = battlefield(g).filter((c) => isLand(c) && c.tapped);
  if (tapped.length) pickCards(g, you, tapped, { min: 0, max: n, text: `untap up to ${n} lands`, button: 'Untap', then: 'untap' });
};

registerScripts({
  // ===== Counterspells and spells that move spells =====
  'Render Silent': {
    targets: [anySpell],
    onResolve: (g, { targets }) => {
      const item = refStack(g, targets[0]);
      if (!item) return;
      counter(g, targets[0]);
      // "Its controller can't cast spells this turn": a separate instruction, even if the spell can't be countered.
      addEffect(g, { kind: 'cantCast', player: item.controller });
    },
  },
  'Spell Swindle': {
    targets: [anySpell],
    onResolve: (g, { you, targets }) => {
      const item = refStack(g, targets[0]);
      if (!item) return;
      // "Where X is that spell's mana value": X counts while it is on the stack (202.3e).
      const x = manaValue(item.card);
      counter(g, targets[0]);
      createToken(g, you, 'Treasure', x);
    },
  },
  Reprieve: {
    targets: [anySpell],
    onResolve: (g, { you, targets }) => {
      const item = refStack(g, targets[0]);
      if (!item) return;
      // Returning a spell isn't countering it, so "can't be countered" doesn't stop it. A copy ceases to exist (707.10a).
      const owner = g.players[item.card.owner];
      log(g, `${label(item.card)} is returned to ${owner.you ? 'your' : `${owner.name}'s`} hand.`, item.controller, [item.card]);
      moveCard(g, item.card, 'hand');
      draw(g, you);
    },
  },

  // ===== Removal =====
  'Snuff Out': {
    // "If you control a Swamp, you may pay 4 life rather than pay this spell's mana cost." (118.9)
    alternativeCosts: [{ label: 'pay 4 life (you control a Swamp)', mana: '', life: 4, when: (g, self) => controls(g, self.controller, 'Swamp') }],
    targets: [creature('target nonblack creature', (_g, c) => !isColor(c, 'B'))],
    // "It can't be regenerated": nothing in the game regenerates (701.19), so there is nothing to stop.
    onResolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  'Baleful Mastery': {
    alternativeCosts: [{ label: 'pay {1}{B}', mana: '{1}{B}' }],
    targets: [{ type: 'creature or planeswalker', label: 'target creature or planeswalker' }],
    onResolve: (g, { self, you, targets }) => {
      // "If the {1}{B} cost was paid, an opponent draws a card." The spell's controller picks the opponent, then the exile follows.
      const opponents = opponentsOf(g, you).map((p) => p.id);
      if (self.cast?.alt === 0 && opponents.length) choosePlayer(g, you, { text: 'Choose an opponent to draw a card.', options: opponents, then: 'mastery' });
      else exile(g, refCard(g, targets[0]));
    },
    then: {
      mastery: (g, { player, targets }) => {
        if (player !== null) draw(g, player);
        exile(g, refCard(g, targets[0]));
      },
    },
  },
  'Toxic Deluge': {
    // "As an additional cost to cast this spell, pay X life. All creatures get -X/-X until end of turn."
    additionalCost: { life: 'x' },
    onResolve: (g, { self }) => {
      const x = self.cast?.x ?? 0;
      for (const c of allCreatures(g)) pump(g, c, -x, -x);
    },
  },
  'The Battle of Bywater': {
    onResolve: (g, { you }) => {
      destroyMany(g, allCreatures(g).filter((c) => stats(g, c).power >= 3));
      // "Then create a Food token for each creature you control": counted after the destruction.
      createToken(g, you, 'Food', creaturesOf(g, you).length);
    },
  },
  Exsanguinate: {
    // "Each opponent loses X life. You gain life equal to the life lost this way."
    onResolve: (g, { self, you }) => gainLife(g, you, eachOpponentLoses(g, you, self.cast?.x ?? 0)),
  },
  'Rakdos Charm': {
    modal: {
      min: 1,
      max: 1,
      modes: [
        {
          text: "Exile target player's graveyard.",
          targets: [anyPlayer],
          resolve: (g, { targets }) => {
            const p = refPlayer(g, targets[0]);
            if (!p || !p.graveyard.length) return;
            log(g, `${p.name}'s graveyard is exiled.`, p.id, [...p.graveyard]);
            for (const c of [...p.graveyard]) moveCard(g, c, 'exile');
          },
        },
        { text: 'Destroy target artifact.', targets: [{ type: 'permanent', label: 'target artifact', filter: (_g, c) => hasType(c, 'Artifact') }], resolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])) },
        {
          text: 'Each creature deals 1 damage to its controller.',
          resolve: (g) => {
            simultaneously(g, () => allCreatures(g).forEach((c) => void damagePlayer(g, c, c.controller, 1)));
          },
        },
      ],
    },
  },

  // ===== Graveyards =====
  Reanimate: {
    targets: [graveyardCard('target creature card in a graveyard', isCreature)],
    onResolve: (g, { you, targets }) => {
      const c = refGraveyard(g, targets[0]);
      if (!c) return;
      // "Under your control" (110.2a). "You lose life equal to that card's mana value": as it was in the graveyard.
      const mv = manaValue(c);
      enterBattlefield(g, c, { controller: you });
      loseLife(g, you, mv);
    },
  },
  'Academy Ruins': {
    mana: { amount: 1, colors: ['C'] },
    activated: {
      cost: { mana: '{1}{U}', tap: true },
      targets: [graveyardCard('target artifact card in your graveyard', (c) => hasType(c, 'Artifact'), 'you')],
      text: '{1}{U}, {T}: Put target artifact card from your graveyard on top of your library.',
      resolve: (g, { targets }) => {
        const c = refGraveyard(g, targets[0]);
        if (c) putOnTop(g, c);
      },
    },
  },
  "Hall of Heliod's Generosity": {
    mana: { amount: 1, colors: ['C'] },
    activated: {
      cost: { mana: '{1}{W}', tap: true },
      targets: [graveyardCard('target enchantment card in your graveyard', (c) => hasType(c, 'Enchantment'), 'you')],
      text: '{1}{W}, {T}: Put target enchantment card from your graveyard on top of your library.',
      resolve: (g, { targets }) => {
        const c = refGraveyard(g, targets[0]);
        if (c) putOnTop(g, c);
      },
    },
  },
  'Sharuum the Hegemon': {
    // "When Sharuum enters, you may return target artifact card from your graveyard to the battlefield."
    // The target is chosen as it triggers (603.3d); whether to return it, as it resolves (608.2d).
    targets: [graveyardCard('target artifact card in your graveyard', (c) => hasType(c, 'Artifact'), 'you')],
    onEnter: (g, { you }) => ask(g, you, { text: 'Return the artifact card to the battlefield?', yes: 'Return', no: "Don't Return", then: 'return' }),
    then: {
      return: (g, { you, yes, targets }) => {
        const c = yes ? refGraveyard(g, targets[0]) : undefined;
        if (c) enterBattlefield(g, c, { controller: you });
      },
    },
  },
  'Takenuma, Abandoned Mire': {
    mana: { amount: 1, colors: ['B'] },
    // Channel: "{3}{B}, Discard this card: Mill three cards, then return a creature or planeswalker card from
    // your graveyard to your hand. This ability costs {1} less to activate for each legendary creature you control."
    activated: {
      cost: { mana: '{3}{B}', discardSelf: true },
      fromHand: true,
      reduction: (g, self) => creaturesOf(g, self.owner).filter((c) => hasType(c, 'Legendary')).length,
      text: 'Channel — {3}{B}, Discard this card: Mill three cards, then return a creature or planeswalker card from your graveyard to your hand.',
      resolve: (g, { you }) => {
        mill(g, you, 3);
        // "A ... card": not a target, chosen as it resolves, and it must be one if there is one.
        const options = g.players[you].graveyard.filter((c) => isCreature(c) || isPlaneswalker(c));
        if (options.length) pickCards(g, you, options, { min: 1, max: 1, text: 'return a creature or planeswalker card to your hand', button: 'Return', then: 'return' });
      },
    },
    then: {
      return: (g, { picked }) => {
        for (const c of picked) if (c.zone === 'graveyard') moveCard(g, c, 'hand');
      },
    },
  },

  // ===== Card draw =====
  'Frantic Search': {
    // "Draw two cards, then discard two cards. Untap up to three lands."
    onResolve: (g, { you }) => {
      draw(g, you, 2);
      const hand = g.players[you].hand;
      if (hand.length) pickCards(g, you, hand, { min: Math.min(2, hand.length), max: 2, text: 'discard two cards', button: 'Discard', then: 'discarded' });
      else untapLands(g, you, 3);
    },
    then: {
      discarded: (g, { you, picked }) => {
        for (const c of picked) discard(g, c);
        untapLands(g, you, 3);
      },
      untap: (_g, { picked }) => {
        for (const c of picked) c.tapped = false;
      },
    },
  },
  'Grab the Prize': {
    // "As an additional cost to cast this spell, discard a card. Draw two cards. If the
    // discarded card wasn't a land card, Grab the Prize deals 2 damage to each opponent."
    additionalCost: { discard: 1 },
    onResolve: (g, { self, you }) => {
      draw(g, you, 2);
      const discarded = self.cast?.discarded?.[0];
      if (discarded && !isLand(discarded)) simultaneously(g, () => opponentsOf(g, you).forEach((o) => void damagePlayer(g, self, o.id, 2)));
    },
  },
  Windfall: {
    // "Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way."
    onResolve: (g) => {
      const order = turnOrder(g, g.active);
      let most = 0;
      for (const pid of order) {
        const hand = [...g.players[pid].hand];
        most = Math.max(most, hand.length);
        for (const c of hand) discard(g, c);
      }
      for (const pid of order) draw(g, pid, most); // in turn order (121.2c)
    },
  },
  'Consecrated Sphinx': {
    // "Whenever an opponent draws a card, you may draw two cards." Each card is drawn on its own, so it triggers for each (121.2).
    onDraw: { when: (g, { self, player }) => isOpponent(g, self.controller, player), resolve: (g, { you }) => mayDraw(g, you, 2) },
    then: mayDrawThen,
    botChoice: botDraws,
  },
  'Faerie Mastermind': {
    // "Whenever an opponent draws their second card each turn, you draw a card."
    onDraw: { when: (g, { self, player }) => isOpponent(g, self.controller, player) && g.players[player].drawn === 2, resolve: (g, { you }) => draw(g, you) },
    activated: {
      cost: { mana: '{3}{U}' },
      text: '{3}{U}: Each player draws a card.',
      resolve: (g) => {
        for (const pid of turnOrder(g, g.active)) draw(g, pid); // 121.2c
      },
    },
  },
  'Niv-Mizzet, Ghost Counsel': {
    // "Whenever you gain life, you may pay that much life. If you do, draw that many cards." Life is paid only with that much (119.4).
    onLifeGain: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you, amount }) =>
        ask(g, you, { text: `Pay ${amount} life to draw ${amount === 1 ? 'a card' : `${amount} cards`}?`, life: amount, yes: `Pay ${amount} Life`, no: "Don't Pay", then: 'counsel', data: { n: amount } }),
    },
    then: { counsel: (g, { you, yes, data }) => yes && draw(g, you, data.n as number) },
    // A bot pays while it has life to spare and cards to draw.
    botChoice: { counsel: (g, pid, choice) => ({ type: 'answer', yes: choice.kind === 'ask' && g.players[pid].life - (choice.life ?? 0) > 15 && g.players[pid].library.length > 5 }) },
    activated: {
      cost: { tap: true },
      text: '{T}: Each opponent loses 1 life and you gain 1 life.',
      resolve: (g, { you }) => {
        eachOpponentLoses(g, you, 1);
        gainLife(g, you, 1);
      },
    },
  },
  'Gran-Gran': {
    // "Whenever Gran-Gran becomes tapped, draw a card, then discard a card."
    onTapped: (g, { you }) => {
      draw(g, you);
      chooseToDiscard(g, you, 1);
    },
    // "Noncreature spells you cast cost {1} less to cast as long as there are three or more Lesson cards in your graveyard."
    costModifier: (g, self, spell, caster) =>
      caster === self.controller && !isCreature(spell) && g.players[self.controller].graveyard.filter((c) => subtypesOf(c).includes('Lesson')).length >= 3 ? -1 : 0,
  },

  // ===== Lands, mana and permanents =====
  'Land Tax': {
    // "At the beginning of your upkeep, if an opponent controls more lands than you, you may search your library for up
    // to three basic land cards, reveal them, put them into your hand, then shuffle." The "if" is checked twice (603.4).
    onUpkeep: {
      when: (g, { self, player }) => player === self.controller && opponentsOf(g, player).some((o) => landCount(g, o.id) > landCount(g, player)),
      resolve: (g, { you }) => {
        if (!opponentsOf(g, you).some((o) => landCount(g, o.id) > landCount(g, you))) return;
        ask(g, you, { text: 'Search your library for up to three basic land cards?', yes: 'Search', no: "Don't Search", then: 'tax' });
      },
    },
    then: { tax: (g, { you, yes }) => yes && search(g, you, 'hand', { basic: true, label: 'up to three basic land cards' }, { reveal: true, count: 3 }) },
  },
  'Mana Geyser': {
    ai: 'ritual',
    // "Add {R} for each tapped land your opponents control."
    onResolve: (g, { self, you }) => {
      const n = opponentsOf(g, you).reduce((k, o) => k + o.battlefield.filter((c) => isLand(c) && c.tapped).length, 0);
      addMana(g, you, Array<ManaSym>(n).fill('R'), self);
    },
  },
  'Emergence Zone': {
    mana: { amount: 1, colors: ['C'] },
    activated: {
      cost: { mana: '{1}', tap: true, sacrifice: true },
      text: '{1}, {T}, Sacrifice this land: You may cast spells this turn as though they had flash.',
      resolve: (g, { you }) => addEffect(g, { kind: 'flash', player: you }),
    },
  },
  'High Fae Trickster': { grantsFlash: (_g, self, pid) => pid === self.controller },
  'Leyline of Anticipation': {
    grantsFlash: (_g, self, pid) => pid === self.controller,
    // "If this card is in your opening hand, you may begin the game with it on the battlefield." (103.6a)
    openingHand: (g, self, pid) =>
      ask(g, pid, { text: 'Begin the game with Leyline of Anticipation on the battlefield?', yes: 'Begin with It', no: 'Keep in Hand', then: 'begin', script: self.id }),
    then: {
      begin: (g, { self, you, yes }) => {
        if (!yes || self.zone !== 'hand') return;
        log(g, `${says(g.players[you], 'begins')} the game with Leyline of Anticipation on the battlefield.`, you, [self]);
        enterBattlefield(g, self, { controller: you });
      },
    },
  },
  'Unstoppable Plan': {
    // "At the beginning of your end step, untap all nonland permanents you control."
    onEndStep: {
      when: yourTurnStep,
      resolve: (g, { you }) => {
        for (const c of g.players[you].battlefield) if (!isLand(c)) c.tapped = false;
      },
    },
  },
  'Descent into Avernus': {
    // "At the beginning of your upkeep, put two descent counters on this enchantment. Then each player creates X Treasure
    // tokens and this enchantment deals X damage to each player, where X is the number of descent counters on this enchantment."
    onUpkeep: {
      when: yourTurnStep,
      resolve: (g, { self }) => {
        const me = stillThere(g, self);
        if (me) addCounters(g, me, 2, 'descent');
        // Gone, it counts as it last was (608.2h).
        const source = me ?? self;
        const x = source.counters.descent ?? 0;
        const order = turnOrder(g, g.active);
        for (const pid of order) createToken(g, pid, 'Treasure', x);
        simultaneously(g, () => order.forEach((pid) => void damagePlayer(g, source, pid, x)));
      },
    },
  },
  'The Vision and Scarlet Witch': {
    // "Whenever you cast a spell, add {R} and put a +1/+1 counter on The Vision and Scarlet Witch."
    // Triggered, not a mana ability: it uses the stack (605.1b).
    onCast: {
      when: (_g, { self, caster }) => caster === self.controller,
      resolve: (g, { self, you }) => {
        addMana(g, you, ['R'], self);
        addCounters(g, stillThere(g, self));
      },
    },
  },

  // ===== Creatures =====
  'Recruiter of the Guard': {
    // "When this creature enters, you may search your library for a creature card with toughness 2 or less, reveal it,
    // put it into your hand, then shuffle." Not a target; a search for a stated quality may find nothing (701.23b).
    onEnter: (g, { you }) => ask(g, you, { text: 'Search your library for a creature card with toughness 2 or less?', yes: 'Search', no: "Don't Search", then: 'recruit' }),
    then: { recruit: (g, { you, yes }) => yes && search(g, you, 'hand', { types: ['Creature'], maxToughness: 2, label: 'a creature card with toughness 2 or less' }, { reveal: true }) },
  },
  'Whitemane Lion': {
    // "When this creature enters, return a creature you control to its owner's hand." Not a target: chosen as it
    // resolves, and it may be the Lion itself.
    onEnter: (g, { you }) => {
      const mine = creaturesOf(g, you);
      if (mine.length) pickCards(g, you, mine, { min: 1, max: 1, text: "return a creature you control to its owner's hand", button: 'Return', then: 'return' });
    },
    then: { return: (g, { picked }) => picked.forEach((c) => bounce(g, permanent(g, c.id))) },
  },
  'Flickering Hound': {
    // "Whenever you cast a creature spell, exile up to one other target creature you control, then return that card to
    // the battlefield under its owner's control."
    onCast: {
      when: (_g, { self, card, caster }) => caster === self.controller && isCreature(card),
      targets: [{ type: 'creature', who: 'you', optional: true, label: 'up to one other target creature you control', filter: (_g, c, source) => c.id !== source.id }],
      resolve: (g, { targets }) => flicker(g, refCard(g, targets[0])),
      text: 'Whenever you cast a creature spell, exile up to one other target creature you control, then return it.',
    },
  },
  'Lyse Hext': {
    onCast: prowess,
    // "Noncreature spells you cast cost {1} less to cast."
    costModifier: (_g, self, spell, caster) => (caster === self.controller && !isCreature(spell) ? -1 : 0),
    // "As long as you've cast two or more noncreature spells this turn, Lyse Hext has double strike."
    static: (g, self, c) => (c.id === self.id && g.players[self.controller].noncreatureSpellsCast >= 2 ? { keywords: ['double strike'] } : null),
  },
  'Nezahal, Primal Tide': {
    uncounterable: true,
    noMaxHandSize: true,
    // "Whenever an opponent casts a noncreature spell, draw a card."
    onCast: { when: (g, { self, card, caster }) => isOpponent(g, self.controller, caster) && !isCreature(card), resolve: (g, { you }) => draw(g, you) },
    // "Discard three cards: Exile Nezahal. Return it to the battlefield tapped under its owner's control at the beginning of the next end step."
    activated: {
      cost: { discard: 3 },
      text: 'Discard three cards: Exile Nezahal. Return it at the beginning of the next end step.',
      resolve: (g, { self, you }) => {
        const me = stillThere(g, self);
        if (!me) return;
        exile(g, me);
        if (me.zone === 'exile') delay(g, me, you, { key: 'return', step: 'end', data: { id: me.id, moves: me.moves } });
      },
    },
    delayed: {
      return: (g, { data }) => {
        const c = g.players.flatMap((p) => p.exile).find((x) => sameCard(x, { id: data.id as string, moves: data.moves as number }));
        if (c) enterBattlefield(g, c, { controller: c.owner, tapped: true });
      },
    },
  },
});
