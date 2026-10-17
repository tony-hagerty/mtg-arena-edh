// Real cards that aren't in the card pool yet, with scripts, so tests can try out rules
// the pool doesn't use: X, hybrid, Phyrexian, kicker, sacrifice and alternative costs,
// cost changes, counterspells, modal spells, copying spells, counters, Auras, Equipment,
// Vehicles, planeswalkers, battles, double-faced, split and adventurer cards, Sagas,
// Classes, flashback and Treasure, Food and Clue tokens. Importing this file registers
// them. Their data comes from Scryfall: list a name in tests/fixture-cards.json and run
// `npm run fetch-cards`, which writes tests/fixtures.generated.json.
import { registerCards } from '../src/cards/db';
import generated from './fixtures.generated.json';
import {
  CANT_ATTACK,
  firstDrawInDrawStep,
  simultaneously,
  subtypesOf,
  addMana,
  attach,
  nameCard,
  refGraveyard,
  CANT_BLOCK,
  abilitySource,
  addCounters,
  allCreatures,
  becomeCopy,
  copyOf,
  manaValue,
  pickCards,
  attachedBonus,
  crew,
  equip,
  permanent,
  shuffle,
  battlefield,
  copySpell,
  counter,
  createToken,
  label,
  log,
  loseLife,
  transform,
  gainLife,
  creaturesOf,
  damageCard,
  damagePlayer,
  dealDamage,
  destroy,
  draw,
  hasType,
  isColor,
  isCreature,
  moveCard,
  opponentsOf,
  pump,
  refCard,
  refPlayer,
} from '../src/engine';
import { registerScripts } from '../src/engine/registry';
import type { Card, CardData, Game, ManaSym, TargetSpec } from '../src/engine';

registerCards((generated as { cards: Record<string, CardData> }).cards);

/** Exiles a card from its graveyard, if it is still there. */
const exileFromGraveyard = (g: Game, c: Card | undefined) => {
  if (!c || c.zone !== 'graveyard') return;
  log(g, `${label(c)} is exiled from a graveyard.`, c.owner, [c]);
  moveCard(g, c, 'exile');
};

const anyTarget: TargetSpec = { type: 'any', label: 'any target' };
const land: TargetSpec = { type: 'permanent', label: 'target land', filter: (g, c) => hasType(g, c, 'Land') };

registerScripts({
  Blaze: { targets: [anyTarget], onResolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], self.cast?.x ?? 0) },
  'Gut Shot': { targets: [anyTarget], onResolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 1) },
  'Burst Lightning': {
    kicker: { mana: '{4}' },
    targets: [anyTarget],
    onResolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], self.cast?.kicked ? 4 : 2),
  },
  'Bone Splinters': {
    additionalCost: { sacrifice: { type: 'creature', who: 'you', label: 'a creature to sacrifice' } },
    targets: [{ type: 'creature', label: 'target creature' }],
    onResolve: (g, { targets }) => destroy(g, refCard(g, targets[0])),
  },
  'Flawless Maneuver': {
    alternativeCosts: [
      {
        label: 'free: you control a commander',
        mana: '',
        when: (g, self) => g.players[self.controller].battlefield.some((c) => c.isCommander),
      },
    ],
    onResolve: (g, { you }) => {
      for (const c of creaturesOf(g, you)) pump(g, c, 0, 0, ['indestructible']);
    },
  },
  'Thalia, Guardian of Thraben': { costModifier: (g, _self, spell) => (isCreature(g, spell) ? 0 : 1) },
  Counterspell: { targets: [{ type: 'spell', label: 'target spell' }], onResolve: (g, { targets }) => counter(g, targets[0]) },
  Negate: {
    targets: [{ type: 'spell', label: 'target noncreature spell', filter: (g, c) => !isCreature(g, c) }],
    onResolve: (g, { targets }) => counter(g, targets[0]),
  },
  'Essence Scatter': {
    targets: [{ type: 'spell', label: 'target creature spell', filter: (g, c) => isCreature(g, c) }],
    onResolve: (g, { targets }) => counter(g, targets[0]),
  },
  Stifle: { targets: [{ type: 'ability', label: 'target activated or triggered ability' }], onResolve: (g, { targets }) => counter(g, targets[0]) },
  'Cryptic Command': {
    modal: {
      min: 2,
      max: 2,
      modes: [
        { text: 'Counter target spell.', targets: [{ type: 'spell', label: 'target spell' }], resolve: (g, { targets }) => counter(g, targets[0]) },
        {
          text: "Return target permanent to its owner's hand.",
          targets: [{ type: 'permanent', label: 'target permanent' }],
          resolve: (g, { targets }) => {
            const c = refCard(g, targets[0]);
            if (c) moveCard(g, c, 'hand');
          },
        },
        {
          text: 'Tap all creatures your opponents control.',
          resolve: (g, { you }) => {
            for (const o of opponentsOf(g, you)) for (const c of creaturesOf(g, o.id)) c.tapped = true;
          },
        },
        { text: 'Draw a card.', resolve: (g, { you }) => draw(g, you) },
      ],
    },
  },
  'Boros Charm': {
    modal: {
      min: 1,
      max: 1,
      modes: [
        {
          text: 'Boros Charm deals 4 damage to target player.',
          targets: [{ type: 'player', label: 'target player' }],
          resolve: (g, { self, targets }) => {
            const p = refPlayer(g, targets[0]);
            if (p) damagePlayer(g, self, p.id, 4);
          },
        },
        {
          text: 'Permanents you control gain indestructible until end of turn.',
          resolve: (g, { you }) => {
            for (const c of battlefield(g).filter((x) => x.controller === you)) pump(g, c, 0, 0, ['indestructible']);
          },
        },
        {
          text: 'Target creature gains double strike until end of turn.',
          targets: [{ type: 'creature', label: 'target creature' }],
          resolve: (g, { targets }) => pump(g, refCard(g, targets[0]), 0, 0, ['double strike']),
        },
      ],
    },
  },
  'Fiery Confluence': {
    modal: {
      min: 3,
      max: 3,
      repeat: true,
      modes: [
        {
          text: 'Fiery Confluence deals 1 damage to each creature.',
          resolve: (g, { self }) => {
            for (const c of allCreatures(g)) damageCard(g, self, c, 1);
          },
        },
        {
          text: 'Fiery Confluence deals 2 damage to each opponent.',
          resolve: (g, { self, you }) => {
            for (const o of opponentsOf(g, you)) damagePlayer(g, self, o.id, 2);
          },
        },
        {
          text: 'Destroy target artifact.',
          targets: [{ type: 'permanent', label: 'target artifact', filter: (g, c) => hasType(g, c, 'Artifact') }],
          resolve: (g, { targets }) => destroy(g, refCard(g, targets[0])),
        },
      ],
    },
  },
  Reverberate: {
    targets: [{ type: 'spell', label: 'target instant or sorcery spell', filter: (g, c) => hasType(g, c, 'Instant') || hasType(g, c, 'Sorcery') }],
    onResolve: (g, { you, targets }) => copySpell(g, targets[0], you),
  },
  Pacifism: {
    enchant: { type: 'creature', label: 'target creature' },
    static: attachedBonus({ keywords: [CANT_ATTACK, CANT_BLOCK] }),
  },
  'Holy Strength': { enchant: { type: 'creature', label: 'target creature' }, static: attachedBonus({ power: 1, toughness: 2 }) },
  Bonesplitter: { static: attachedBonus({ power: 2 }), activated: equip('{1}') },
  // Two activated abilities besides equip: one at any time, one as a sorcery (602, 702.6a).
  'Cranial Plating': {
    // "Equipped creature gets +1/+0 for each artifact you control."
    static: (g, self, c) => (self.attachedTo === c.id ? { power: battlefield(g).filter((x) => x.controller === self.controller && hasType(g, x, 'Artifact')).length } : null),
    activated: [
      {
        // "{B}{B}: Attach this Equipment to target creature you control." No timing limit, unlike equip.
        cost: { mana: '{B}{B}' },
        targets: [{ type: 'creature', who: 'you', label: 'target creature you control' }],
        text: '{B}{B}: Attach this Equipment to target creature you control.',
        resolve: (g, { self, targets }) => attach(g, permanent(g, self.id), refCard(g, targets[0])),
      },
      equip('{1}'),
    ],
  },
  // Three activated abilities, each with a target in a graveyard. The first adds mana but
  // targets, so it isn't a mana ability and uses the stack (605.1a).
  'Deathrite Shaman': {
    activated: [
      {
        // "{T}: Exile target land card from a graveyard. Add one mana of any color."
        cost: { tap: true },
        targets: [{ type: 'graveyard card', label: 'target land card from a graveyard', filter: (g, c) => hasType(g, c, 'Land') }],
        text: '{T}: Exile target land card from a graveyard. Add one mana of any color.',
        resolve: (g, { you, targets }) => {
          exileFromGraveyard(g, refGraveyard(g, targets[0]));
          nameCard(g, you, { of: 'color', text: 'Add one mana of any color.', then: 'mana' });
        },
      },
      {
        // "{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life."
        cost: { mana: '{B}', tap: true },
        targets: [{ type: 'graveyard card', label: 'target instant or sorcery card from a graveyard', filter: (g, c) => hasType(g, c, 'Instant') || hasType(g, c, 'Sorcery') }],
        text: '{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life.',
        resolve: (g, { you, targets }) => {
          exileFromGraveyard(g, refGraveyard(g, targets[0]));
          for (const o of opponentsOf(g, you)) loseLife(g, o.id, 2);
        },
      },
      {
        // "{G}, {T}: Exile target creature card from a graveyard. You gain 2 life."
        cost: { mana: '{G}', tap: true },
        targets: [{ type: 'graveyard card', label: 'target creature card from a graveyard', filter: (g, c) => hasType(g, c, 'Creature') }],
        text: '{G}, {T}: Exile target creature card from a graveyard. You gain 2 life.',
        resolve: (g, { you, targets }) => {
          exileFromGraveyard(g, refGraveyard(g, targets[0]));
          gainLife(g, you, 2);
        },
      },
    ],
    then: { mana: (g, { self, you, name }) => addMana(g, you, [name as ManaSym], self) },
  },
  // {X} in an activated ability's cost (107.3a), paid with black mana only.
  'Crypt Rats': {
    activated: {
      // "{X}: This creature deals X damage to each creature and each player. Spend only black mana on X."
      cost: { mana: '{X}', xColor: 'B' },
      text: '{X}: This creature deals X damage to each creature and each player. Spend only black mana on X.',
      resolve: (g, { self, x }) => {
        const n = x ?? 0;
        if (n <= 0) return; // 0 damage isn't dealt (120.8)
        log(g, `${label(self)} deals ${n} damage to each creature and each player.`, self.controller, [self]);
        for (const c of allCreatures(g)) damageCard(g, self, c, n);
        for (const p of g.players) if (!p.lost) damagePlayer(g, self, p.id, n);
      },
    },
  },
  // A −X loyalty ability (606.4): X is announced as it is activated (107.3a).
  'Chandra Nalaar': {
    loyalty: [
      {
        cost: 1,
        text: 'Chandra Nalaar deals 1 damage to target player or planeswalker.',
        targets: [{ type: 'player or planeswalker', label: 'target player or planeswalker' }],
        resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 1),
      },
      {
        cost: '-X',
        text: 'Chandra Nalaar deals X damage to target creature.',
        targets: [{ type: 'creature', label: 'target creature' }],
        resolve: (g, { self, targets, x }) => void dealDamage(g, self, targets[0], x ?? 0),
      },
      {
        cost: -8,
        text: "Chandra Nalaar deals 10 damage to target player or planeswalker and each creature that player or that planeswalker's controller controls.",
        targets: [{ type: 'player or planeswalker', label: 'target player or planeswalker' }],
        resolve: (g, { self, targets }) => {
          // The player, or the planeswalker's controller as the ability resolves.
          const walker = refCard(g, targets[0]);
          const pid = walker ? walker.controller : refPlayer(g, targets[0])?.id;
          dealDamage(g, self, targets[0], 10);
          if (pid !== undefined) for (const c of creaturesOf(g, pid)) dealDamage(g, self, { kind: 'card', id: c.id }, 10);
        },
      },
    ],
  },
  'Loxodon Warhammer': { static:attachedBonus({ power: 3, keywords: ['trample', 'lifelink'] }), activated: equip('{3}') },
  'Untethered Express': { onAttack: (g, { self }) => addCounters(g, permanent(g, self.id)), activated: crew(1) },
  "Black Sun's Zenith": {
    onResolve: (g, { self }) => {
      for (const c of allCreatures(g)) addCounters(g, c, self.cast?.x ?? 0, '-1/-1');
      moveCard(g, self, 'library');
      shuffle(g, g.players[self.owner].library);
    },
  },
  'Jace Beleren': {
    loyalty: [
      { cost: 2, text: 'Each player draws a card.', resolve: (g) => g.players.forEach((p) => draw(g, p.id, 1)) },
      {
        cost: -1,
        text: 'Target player draws a card.',
        targets: [{ type: 'player', label: 'target player' }],
        resolve: (g, { targets }) => {
          const p = refPlayer(g, targets[0]);
          if (p) draw(g, p.id, 1);
        },
      },
      {
        cost: -10,
        text: 'Target player mills twenty cards.',
        targets: [{ type: 'player', label: 'target player' }],
        resolve: (g, { targets }) => {
          const p = refPlayer(g, targets[0]);
          if (p) for (const c of p.library.slice(0, 20)) moveCard(g, c, 'graveyard');
        },
      },
    ],
  },
  'Garruk Wildspeaker': {
    loyalty: [
      {
        cost: 1,
        text: 'Untap two target lands.',
        targets: [land, land],
        resolve: (g, { targets }) => {
          for (const c of new Set(targets.map((t) => refCard(g, t)))) if (c) c.tapped = false;
        },
      },
      { cost: -1, text: 'Create a 3/3 green Beast creature token.', resolve: (g, { you }) => createToken(g, you, 'Beast 3/3') },
      {
        cost: -4,
        text: 'Creatures you control get +3/+3 and gain trample until end of turn.',
        resolve: (g, { you }) => creaturesOf(g, you).forEach((c) => pump(g, c, 3, 3, ['trample'])),
      },
    ],
  },
  'Invasion of Dominaria': {
    onEnter: (g, { you }) => {
      gainLife(g, you, 4);
      draw(g, you, 1);
    },
  },
  'Ruby Medallion': { costModifier: (g, self, spell, caster) => (caster === self.controller && isColor(g, spell, 'R') ? -1 : 0) },

  // ---------- double-faced, split and adventurer cards (712, 709, 715) ----------
  'Delver of Secrets': {
    onUpkeep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { self, you }) => {
        // Look at the top card; revealing an instant or sorcery is free upside, so it always happens.
        const top = g.players[you].library[0];
        if (!top || !(hasType(g, top, 'Instant') || hasType(g, top, 'Sorcery'))) return;
        log(g, `${g.players[you].name} reveals ${label(top)}.`, you, [top]);
        transform(g, permanent(g, self.id));
      },
    },
  },
  'Kazandu Mammoth': {
    onLandfall: {
      when: (_g, { self, land }) => land.controller === self.controller,
      resolve: (g, { self }) => pump(g, permanent(g, self.id), 2, 2),
    },
  },
  'Kazandu Valley': { entersTapped: true, mana: { amount: 1, colors: ['G'] } },
  'Needleverge Pathway': { mana: { amount: 1, colors: ['R'] } },
  'Pillarverge Pathway': { mana: { amount: 1, colors: ['W'] } },
  Dead: { targets: [{ type: 'creature', label: 'target creature' }], onResolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 2) },
  Gone: {
    targets: [{ type: 'creature', who: 'opponent', label: "target creature you don't control" }],
    onResolve: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (c) moveCard(g, c, 'hand');
    },
  },
  'Murderous Rider': {
    onDies: (g, { self }) => {
      const c = g.players[self.owner].graveyard.find((x) => x.id === self.id);
      if (c) moveCard(g, c, 'library'); // the bottom: the library's last card
    },
  },
  'Swift End': {
    targets: [{ type: 'creature or planeswalker', label: 'target creature or planeswalker' }],
    onResolve: (g, { targets, you }) => {
      destroy(g, refCard(g, targets[0]));
      loseLife(g, you, 2);
    },
  },

  // ---------- Sagas and Classes (714, 716) ----------
  'History of Benalia': {
    chapters: [
      { text: 'Create a 2/2 white Knight creature token with vigilance.', resolve: (g, { you }) => createToken(g, you, 'Knight 2/2 vigilance') },
      { text: 'Create a 2/2 white Knight creature token with vigilance.', resolve: (g, { you }) => createToken(g, you, 'Knight 2/2 vigilance') },
      {
        text: 'Knights you control get +2/+1 until end of turn.',
        resolve: (g, { you }) => creaturesOf(g, you).filter((c) => hasType(g, c, 'Knight')).forEach((c) => pump(g, c, 2, 1)),
      },
    ],
  },
  'Wizard Class': {
    noMaxHandSize: true,
    levels: [
      { cost: '{2}{U}', text: 'Level 2: When this Class becomes level 2, draw two cards.' },
      { cost: '{4}{U}', text: 'Level 3: Whenever you draw a card, put a +1/+1 counter on target creature you control.' },
    ],
    onLevel: { when: (_g, { level }) => level === 2, resolve: (g, { you }) => draw(g, you, 2) },
    onDraw: {
      when: (_g, { self, player }) => self.level >= 3 && player === self.controller,
      targets: [{ type: 'creature', who: 'you', label: 'target creature you control' }],
      resolve: (g, { targets }) => addCounters(g, refCard(g, targets[0])),
    },
  },

  // ---------- flashback (702.34) and predefined tokens (111.10) ----------
  'Think Twice': { flashback: '{2}{U}', onResolve: (g, { you }) => draw(g, you, 1) },
  'Strike It Rich': { flashback: '{2}{R}', onResolve: (g, { you }) => createToken(g, you, 'Treasure') },
  'Thraben Inspector': { onEnter: (g, { you }) => createToken(g, you, 'Clue') },
  'Bake into a Pie': {
    targets: [{ type: 'creature', label: 'target creature' }],
    onResolve: (g, { targets, you }) => {
      destroy(g, refCard(g, targets[0]));
      createToken(g, you, 'Food');
    },
  },

  // ---------- copy effects on the battlefield (707.4) ----------
  'Likeness Looter': {
    activated: [
      // "{T}: Draw a card, then discard a card."
      {
        cost: { tap: true },
        text: 'Draw a card, then discard a card',
        resolve: (g, { you }) => {
          draw(g, you);
          const hand = g.players[you].hand;
          if (hand.length) pickCards(g, you, hand, { min: 1, max: 1, text: 'discard a card', button: 'Discard', then: '@discard' });
        },
      },
      // "{X}: This creature becomes a copy of target creature card in your graveyard with mana
      // value X, except it has flying and this ability. Activate only as a sorcery." The
      // exceptions are part of what it copies (707.9a), so a copy of it has them too.
      {
        cost: { mana: '{X}' },
        sorcery: true,
        targets: [
          {
            type: 'graveyard card',
            who: 'you',
            label: 'target creature card in your graveyard with mana value X',
            filter: (g, c, _self, x) => !c.isToken && hasType(g, c, 'Creature') && manaValue(c) === x,
          },
        ],
        text: 'Become a copy of a creature card in your graveyard with mana value X',
        resolve: (g, { targets }) => {
          // "This creature": the permanent the ability came from, if it is still the same object (400.7).
          const it = abilitySource(g);
          const card = refGraveyard(g, targets[0]);
          if (!it || !card) return;
          becomeCopy(g, it, copyOf(card, { keywords: ['Flying'], activated: [{ from: 'Likeness Looter', index: 1 }] }));
        },
      },
    ],
  },

  // ---------- auto-pay ----------
  // A mana rock with another {T} ability: auto-pay taps lands before it.
  'Mind Stone': {
    mana: { amount: 1, colors: ['C'] },
    activated: {
      // "{1}, {T}, Sacrifice this artifact: Draw a card."
      cost: { mana: '{1}', tap: true, sacrifice: true },
      text: '{1}, {T}, Sacrifice this artifact: Draw a card.',
      resolve: (g, { you }) => draw(g, you, 1),
    },
  },

  // ---------- replacement and prevention effects (614-616) ----------
  'Notion Thief': {
    // "If an opponent would draw a card except the first one they draw in each of their draw
    // steps, instead that player skips that draw and you draw a card." (614.11)
    replaces: (g, self, ev) =>
      ev.kind === 'draw' && ev.player !== self.controller && !ev.firstInDrawStep
        ? { instead: { kind: 'draw', player: self.controller, firstInDrawStep: firstDrawInDrawStep(g, self.controller) } }
        : null,
  },
  'Doubling Season': {
    replaces: (_g, self, ev) => {
      // "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead."
      if (ev.kind === 'tokens' && ev.player === self.controller) return { instead: { ...ev, tokens: ev.tokens.map((t) => ({ ...t, count: t.count * 2 })) } };
      // "If an effect would put one or more counters on a permanent you control, it puts twice
      // that many of those counters on that permanent instead." Not a cost's, or a turn-based action's.
      if (ev.kind === 'counters' && !ev.by && ev.card.controller === self.controller) return { instead: { ...ev, n: ev.n * 2 } };
      return null;
    },
  },
  'Hardened Scales': {
    // "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead."
    replaces: (g, self, ev) =>
      ev.kind === 'counters' && ev.counter === '+1/+1' && ev.card.controller === self.controller && isCreature(g, ev.card) ? { instead: { ...ev, n: ev.n + 1 } } : null,
  },
  'Rhox Faithmender': {
    // "If you would gain life, you gain twice that much life instead."
    replaces: (_g, self, ev) => (ev.kind === 'gainLife' && ev.player === self.controller ? { instead: { ...ev, amount: ev.amount * 2 } } : null),
  },
  'Rest in Peace': {
    // "When this enchantment enters, exile all graveyards."
    onEnter: (g) => {
      const cards = g.players.flatMap((p) => p.graveyard);
      if (!cards.length) return;
      log(g, `${cards.map(label).join(', ')} ${cards.length === 1 ? 'is' : 'are'} exiled from graveyards.`, undefined, cards);
      simultaneously(g, () => cards.forEach((c) => moveCard(g, c, 'exile')));
    },
    // "If a card or token would be put into a graveyard from anywhere, exile it instead."
    replaces: (_g, _self, ev) => (ev.kind === 'move' && ev.to === 'graveyard' ? { instead: { ...ev, to: 'exile' } } : null),
  },
  'Daunting Defender': {
    // "If a source would deal damage to a Cleric creature you control, prevent 1 of that damage." (615.10)
    replaces: (g, self, ev) =>
      ev.kind === 'damage' && ev.card && ev.card.controller === self.controller && isCreature(g, ev.card) && subtypesOf(g, ev.card).includes('Cleric')
        ? { instead: { ...ev, amount: ev.amount - 1 } }
        : null,
  },
});
