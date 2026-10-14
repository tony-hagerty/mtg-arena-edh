// Real cards that aren't in the card pool yet, with scripts, so tests can try out costs
// the pool doesn't use: X, hybrid, Phyrexian, kicker, sacrifice and alternative costs, and
// cost changes. Importing this file registers them. Their data is typed in by hand
// (Scryfall can't be reached from every machine), without images.
import { registerCards } from '../src/cards/db';
import { creaturesOf, dealDamage, destroy, isColor, isCreature, pump, refCard } from '../src/engine';
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
  'Ruby Medallion': { costModifier: (_g, self, spell, caster) => (caster === self.owner && isColor(spell, 'R') ? -1 : 0) },
});
