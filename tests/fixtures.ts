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
  CANT_BLOCK,
  addCounters,
  allCreatures,
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
import type { CardData, TargetSpec } from '../src/engine';

registerCards((generated as { cards: Record<string, CardData> }).cards);

const anyTarget: TargetSpec = { type: 'any', label: 'any target' };
const land: TargetSpec = { type: 'permanent', label: 'target land', filter: (_g, c) => hasType(c, 'Land') };

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
        when: (g, self) => g.players[self.owner].battlefield.some((c) => c.isCommander),
      },
    ],
    onResolve: (g, { you }) => {
      for (const c of creaturesOf(g, you)) pump(g, c, 0, 0, ['indestructible']);
    },
  },
  'Thalia, Guardian of Thraben': { costModifier: (_g, _self, spell) => (isCreature(spell) ? 0 : 1) },
  Counterspell: { targets: [{ type: 'spell', label: 'target spell' }], onResolve: (g, { targets }) => counter(g, targets[0]) },
  Negate: {
    targets: [{ type: 'spell', label: 'target noncreature spell', filter: (_g, c) => !isCreature(c) }],
    onResolve: (g, { targets }) => counter(g, targets[0]),
  },
  'Essence Scatter': {
    targets: [{ type: 'spell', label: 'target creature spell', filter: (_g, c) => isCreature(c) }],
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
            for (const c of battlefield(g).filter((x) => x.owner === you)) pump(g, c, 0, 0, ['indestructible']);
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
          targets: [{ type: 'permanent', label: 'target artifact', filter: (_g, c) => hasType(c, 'Artifact') }],
          resolve: (g, { targets }) => destroy(g, refCard(g, targets[0])),
        },
      ],
    },
  },
  Reverberate: {
    targets: [{ type: 'spell', label: 'target instant or sorcery spell', filter: (_g, c) => hasType(c, 'Instant') || hasType(c, 'Sorcery') }],
    onResolve: (g, { you, targets }) => copySpell(g, targets[0], you),
  },
  Pacifism: {
    enchant: { type: 'creature', label: 'target creature' },
    static: attachedBonus({ keywords: [CANT_ATTACK, CANT_BLOCK] }),
  },
  'Holy Strength': { enchant: { type: 'creature', label: 'target creature' }, static: attachedBonus({ power: 1, toughness: 2 }) },
  Bonesplitter: { static: attachedBonus({ power: 2 }), activated: equip('{1}') },
  'Loxodon Warhammer': { static: attachedBonus({ power: 3, keywords: ['trample', 'lifelink'] }), activated: equip('{3}') },
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
  'Ruby Medallion': { costModifier: (_g, self, spell, caster) => (caster === self.owner && isColor(spell, 'R') ? -1 : 0) },

  // ---------- double-faced, split and adventurer cards (712, 709, 715) ----------
  'Delver of Secrets': {
    onUpkeep: {
      when: (_g, { self, player }) => player === self.owner,
      resolve: (g, { self, you }) => {
        // Look at the top card; revealing an instant or sorcery is free upside, so it always happens.
        const top = g.players[you].library[0];
        if (!top || !(hasType(top, 'Instant') || hasType(top, 'Sorcery'))) return;
        log(g, `${g.players[you].name} reveals ${label(top)}.`, you, [top]);
        transform(g, permanent(g, self.id));
      },
    },
  },
  'Kazandu Mammoth': {
    onLandfall: {
      when: (_g, { self, land }) => land.owner === self.owner,
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
        resolve: (g, { you }) => creaturesOf(g, you).filter((c) => hasType(c, 'Knight')).forEach((c) => pump(g, c, 2, 1)),
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
      when: (_g, { self, player }) => self.level >= 3 && player === self.owner,
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
});
