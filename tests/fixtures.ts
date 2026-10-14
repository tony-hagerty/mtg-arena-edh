// Real cards that aren't in the card pool yet, with scripts, so tests can try out rules
// the pool doesn't use: X, hybrid, Phyrexian, kicker, sacrifice and alternative costs,
// cost changes, counterspells, modal spells, copying spells, counters, Auras, Equipment
// and Vehicles. Importing this file registers them. Their data is typed in by hand
// (Scryfall can't be reached from every machine), without images.
import { registerCards } from '../src/cards/db';
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
import type { CardData, Color, TargetSpec } from '../src/engine';

const card = (name: string, manaCost: string, cmc: number, colors: Color[], typeLine: string, oracleText: string, extra: Partial<CardData> = {}): CardData => ({
  name,
  manaCost,
  cmc,
  colors,
  colorIdentity: colors,
  typeLine,
  oracleText,
  keywords: [],
  image: '',
  art: '',
  ...extra,
});

registerCards({
  Blaze: card('Blaze', '{X}{R}', 1, ['R'], 'Sorcery', 'Blaze deals X damage to any target.'),
  'Boros Recruit': card('Boros Recruit', '{R/W}', 1, ['R', 'W'], 'Creature — Goblin Soldier', 'First strike', {
    power: '1',
    toughness: '1',
    keywords: ['First strike'],
  }),
  'Gut Shot': card('Gut Shot', '{R/P}', 1, ['R'], 'Instant', '({R/P} can be paid with either {R} or 2 life.)\nGut Shot deals 1 damage to any target.'),
  'Spectral Procession': card('Spectral Procession', '{2/W}{2/W}{2/W}', 6, ['W'], 'Sorcery', 'Create three 1/1 white Spirit creature tokens with flying.'),
  'Burst Lightning': card('Burst Lightning', '{R}', 1, ['R'], 'Instant', 'Kicker {4}\nBurst Lightning deals 2 damage to any target. If this spell was kicked, it deals 4 damage instead.', {
    keywords: ['Kicker'],
  }),
  'Bone Splinters': card('Bone Splinters', '{B}', 1, ['B'], 'Sorcery', 'As an additional cost to cast this spell, sacrifice a creature.\nDestroy target creature.'),
  'Flawless Maneuver': card('Flawless Maneuver', '{2}{W}', 3, ['W'], 'Instant', 'If you control a commander, you may cast this spell without paying its mana cost.\nCreatures you control gain indestructible until end of turn.'),
  'Thalia, Guardian of Thraben': card('Thalia, Guardian of Thraben', '{1}{W}', 2, ['W'], 'Legendary Creature — Human Soldier', 'First strike\nNoncreature spells cost {1} more to cast.', {
    power: '2',
    toughness: '1',
    keywords: ['First strike'],
  }),
  'Ruby Medallion': card('Ruby Medallion', '{2}', 2, [], 'Artifact', 'Red spells you cast cost {1} less to cast.'),
  // The pool has no blue deck, so no Island either.
  Island: card('Island', '', 0, [], 'Basic Land — Island', '({T}: Add {U}.)', { colorIdentity: ['U'] }),
  Counterspell: card('Counterspell', '{U}{U}', 2, ['U'], 'Instant', 'Counter target spell.'),
  Negate: card('Negate', '{1}{U}', 2, ['U'], 'Instant', 'Counter target noncreature spell.'),
  'Essence Scatter': card('Essence Scatter', '{1}{U}', 2, ['U'], 'Instant', 'Counter target creature spell.'),
  Stifle: card('Stifle', '{U}', 1, ['U'], 'Instant', 'Counter target activated or triggered ability. (Mana abilities can\'t be targeted.)'),
  'Cryptic Command': card('Cryptic Command', '{1}{U}{U}{U}', 4, ['U'], 'Instant', 'Choose two —\n• Counter target spell.\n• Return target permanent to its owner\'s hand.\n• Tap all creatures your opponents control.\n• Draw a card.'),
  'Boros Charm': card('Boros Charm', '{R}{W}', 2, ['R', 'W'], 'Instant', 'Choose one —\n• Boros Charm deals 4 damage to target player or planeswalker.\n• Permanents you control gain indestructible until end of turn.\n• Target creature gains double strike until end of turn.'),
  'Fiery Confluence': card('Fiery Confluence', '{2}{R}{R}', 4, ['R'], 'Sorcery', 'Choose three. You may choose the same mode more than once.\n• Fiery Confluence deals 1 damage to each creature.\n• Fiery Confluence deals 2 damage to each opponent.\n• Destroy target artifact.'),
  Pacifism: card('Pacifism', '{1}{W}', 2, ['W'], 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack or block.", { keywords: ['Enchant'] }),
  'Holy Strength': card('Holy Strength', '{W}', 1, ['W'], 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+2.', { keywords: ['Enchant'] }),
  Bonesplitter: card('Bonesplitter', '{1}', 1, [], 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {1}', { keywords: ['Equip'] }),
  'Loxodon Warhammer': card('Loxodon Warhammer', '{3}', 3, [], 'Artifact — Equipment', 'Equipped creature gets +3/+0 and has trample and lifelink.\nEquip {3}', {
    keywords: ['Equip'],
  }),
  'Untethered Express': card('Untethered Express', '{4}', 4, [], 'Legendary Artifact — Vehicle', 'Trample\nWhenever Untethered Express attacks, put a +1/+1 counter on it.\nCrew 1', {
    power: '4',
    toughness: '4',
    keywords: ['Trample', 'Crew'],
  }),
  "Black Sun's Zenith": card("Black Sun's Zenith", '{X}{B}{B}', 2, ['B'], 'Sorcery', "Put X -1/-1 counters on each creature. Shuffle Black Sun's Zenith into its owner's library."),
  Reverberate: card('Reverberate', '{R}{R}', 2, ['R'], 'Instant', 'Copy target instant or sorcery spell. You may choose new targets for the copy.'),
});

const anyTarget: TargetSpec = { type: 'any', label: 'any target' };

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
  'Ruby Medallion': { costModifier: (_g, self, spell, caster) => (caster === self.owner && isColor(spell, 'R') ? -1 : 0) },
});
