// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (mana group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care.
//
// Ignoble Hierarch, Noble Hierarch, Faeburrow Elder, Leyline of the Guildpact and Rhythm of
// the Wild need no hand script: the parser reads them (exalted and riot are keywords the
// engine applies, 702.83 and 702.136).
import { registerScripts } from '../../engine/registry';
import {
  addCounters,
  addEffect,
  addMana,
  colorsAmong,
  combinations,
  counter,
  createToken,
  damagePlayer,
  data,
  delay,
  draw,
  enterBattlefield,
  gainLife,
  hasType,
  isCreature,
  isLand,
  isPlaneswalker,
  label,
  log,
  manaValue,
  moveCard,
  opponentsOf,
  parseCost,
  permanent,
  pickCards,
  putOnBottomRandomly,
  refStack,
  sameCard,
  says,
  search,
  shuffle,
  simultaneously,
  stats,
  subtypesOf,
  their,
  untilEndOfTurn,
} from '../../engine/rules';
import type { Card, CardData, CardScript, Game, ManaAbility, PlayerId, TargetSpec } from '../../engine/types';
import { registerToken } from '../db';

/** The permanent, if it is still the object `self` was (400.7). */
const stillThere = (g: Game, self: Card) => {
  const c = permanent(g, self.id);
  return sameCard(c, self) ? c : undefined;
};

/** "Whenever you cast": a spell its controller cast. */
const yourSpell = (e: { self: Card; caster: PlayerId }) => e.caster === e.self.controller;

/** The card types of permanent cards (110.4b). */
const PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

/** Zaxara's "0/0 green Hydra creature token", keyed as the parser keys the tokens it makes. */
const HYDRA = 'Hydra 0/0 G';
const hydra: CardData = { name: 'Hydra', manaCost: '', cmc: 0, colors: ['G'], colorIdentity: ['G'], typeLine: 'Token Creature — Hydra', oracleText: '', power: '0', toughness: '0', keywords: [], image: '', art: '' };
registerToken(HYDRA, hydra);

/** "{T}: Add one mana of any color." */
const anyColor: ManaAbility = { amount: 1, colors: 'any' };

const anySpell: TargetSpec = { type: 'spell', label: 'target spell' };

const scripts: Record<string, CardScript> = {
  'Vivi Ornitier': {
    // "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier's power.
    // Activate only during your turn and only once each turn." A mana ability (605.1a) with no
    // {T} in its cost, so Vivi isn't tapped, and X is its power as it resolves, which is at once (605.3b).
    mana: {
      amount: 1,
      colors: ['U', 'R'],
      noTap: true,
      amountOf: (g, self) => stats(g, self).power,
      producesOf: (g, self) => combinations(['U', 'R'], stats(g, self).power),
      when: (g, self) => g.active === self.controller,
      oncePerTurn: true,
    },
    // "Whenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals
    // 1 damage to each opponent." Gone, it still deals the damage, as it last was (608.2h).
    onCast: {
      when: (g, e) => yourSpell(e) && !isCreature(g, e.card),
      resolve: (g, { self, you }) => {
        const vivi = stillThere(g, self);
        if (vivi) addCounters(g, vivi, 1);
        // Each opponent at once: one event (120.3).
        simultaneously(g, () => {
          for (const o of opponentsOf(g, you)) damagePlayer(g, vivi ?? self, o.id, 1);
        });
      },
    },
  },

  'Kinnan, Bonder Prodigy': {
    // "Whenever you tap a nonland permanent for mana, add one mana of any type that permanent
    // produced." A triggered mana ability (605.1b): it resolves at once (605.4a). Tapping for
    // mana is a mana ability with {T} in its cost (106.12), and the engine asks only when it
    // produced mana (106.12a). Kinnan's controller chooses among the types it produced.
    tappedForMana: (g, self, { source, player, produced }) => (player === self.controller && !isLand(g, source) ? { player, mana: [...new Set(produced)].map((s) => [s]) } : null),
    // "{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature
    // card from among them onto the battlefield. Put the rest on the bottom of your library in a
    // random order."
    activated: {
      cost: { mana: '{5}{G}{U}' },
      text: '{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.',
      resolve: (g, { you }) => {
        const top = g.players[you].library.slice(0, 5);
        if (!top.length) return;
        // In the library a card has its printed characteristics; a changeling is a Human too (702.73a).
        const fits = top.filter((c) => isCreature(g, c) && !subtypesOf(g, c).includes('Human'));
        pickCards(g, you, top, { min: 0, max: 1, pickable: fits, text: 'you may put a non-Human creature card from among them onto the battlefield', button: 'Put onto Battlefield', then: 'kinnan', data: { top: top.map((c) => c.id) } });
      },
    },
    then: {
      kinnan: (g, { you, picked, data: d }) => {
        const p = g.players[you];
        const chosen = picked[0] && p.library.find((c) => c.id === picked[0].id);
        if (chosen) {
          log(g, `${says(p, 'puts')} ${label(chosen)} onto the battlefield.`, you, [chosen]);
          enterBattlefield(g, chosen, { controller: you });
        }
        const rest = (d.top as string[]).map((id) => p.library.find((c) => c.id === id)).filter((c): c is Card => !!c);
        putOnBottomRandomly(g, rest);
        if (rest.length) log(g, `${says(p, 'puts')} ${rest.length === 1 ? 'the other card' : `the other ${rest.length} cards`} on the bottom of ${their(p)} library in a random order.`, you);
      },
    },
    // A bot puts in the biggest creature it may.
    botChoice: {
      kinnan: (g, _pid, choice) => {
        const ids = choice.kind === 'pick' ? (choice.pickable ?? choice.cards) : [];
        const best = ids.map((id) => g.players[choice.player].library.find((c) => c.id === id)).filter((c): c is Card => !!c).sort((a, b) => data(b).cmc - data(a).cmc)[0];
        return { type: 'chooseCards', cards: best ? [best.id] : [] };
      },
    },
  },

  'Baylen, the Haymaker': {
    // "Tap two untapped tokens you control: Add one mana of any color." A mana ability without
    // {T}: Baylen isn't tapped, and tapping the tokens isn't their own {T}, so it doesn't matter
    // that they came under your control this turn (302.6).
    mana: { amount: 1, colors: 'any', noTap: true, tapCreature: { type: '', token: true, count: 2 } },
    activated: [
      // "Tap three untapped tokens you control: Draw a card."
      { cost: { tapUntapped: { type: '', token: true, count: 3 } }, text: 'Tap three untapped tokens you control: Draw a card.', resolve: (g, { you }) => draw(g, you) },
      // "Tap four untapped tokens you control: Put three +1/+1 counters on Baylen. It gains
      // trample until end of turn." Only on Baylen, if it is still the same object (400.7).
      {
        cost: { tapUntapped: { type: '', token: true, count: 4 } },
        text: 'Tap four untapped tokens you control: Put three +1/+1 counters on Baylen. It gains trample until end of turn.',
        resolve: (g, { self }) => {
          const baylen = stillThere(g, self);
          if (!baylen) return;
          addCounters(g, baylen, 3);
          untilEndOfTurn(g, baylen, { keywords: ['trample'] });
        },
      },
    ],
  },

  'Helga, Skittish Seer': {
    // "Whenever you cast a creature spell with mana value 4 or greater, you draw a card, gain 1
    // life, and put a +1/+1 counter on Helga." On the stack, X counts in mana value (202.3e).
    onCast: {
      when: (g, e) => yourSpell(e) && isCreature(g, e.card) && manaValue(e.card) >= 4,
      resolve: (g, { self, you }) => {
        draw(g, you);
        gainLife(g, you, 1);
        const helga = stillThere(g, self);
        if (helga) addCounters(g, helga, 1);
      },
    },
    // "{T}: Add X mana of any one color, where X is Helga's power. Spend this mana only to cast
    // creature spells with mana value 4 or greater or creature spells with {X} in their mana
    // costs." (106.6)
    mana: { amount: 1, colors: 'any', amountOf: (g, self) => stats(g, self).power, types: ['Creature'], minMv: 4, orX: true },
  },

  'Zaxara, the Exemplary': {
    // "{T}: Add two mana of any one color." (106.1b: all of it the same colour)
    mana: { amount: 2, colors: 'any' },
    // "Whenever you cast a spell with {X} in its mana cost, create a 0/0 green Hydra creature
    // token, then put X +1/+1 counters on it." X is the value chosen as the spell was cast (107.3).
    onCast: {
      when: (_g, e) => yourSpell(e) && parseCost(data(e.card).manaCost).x > 0,
      resolve: (g, ctx) => {
        const x = ctx.card.cast?.x ?? 0;
        // Should an effect make more than one Hydra (Doubling Season), each gets the counters.
        for (const made of createToken(g, ctx.you, HYDRA)) if (x > 0) addCounters(g, made, x);
      },
    },
  },

  'Esika, God of the Tree': {
    // "{T}: Add one mana of any color."
    mana: anyColor,
    // 'Other legendary creatures you control have vigilance and "{T}: Add one mana of any color."' (613.1f)
    static: (g, self, c) => (c.id !== self.id && c.controller === self.controller && isCreature(g, c) && hasType(g, c, 'Legendary') ? { keywords: ['vigilance'], mana: anyColor } : null),
  },
  'The Prismatic Bridge': {
    // "At the beginning of your upkeep, reveal cards from the top of your library until you
    // reveal a creature or planeswalker card. Put that card onto the battlefield and the rest on
    // the bottom of your library in a random order." With none, every card is revealed and
    // goes back on the bottom.
    onUpkeep: {
      when: (_g, e) => e.player === e.self.controller,
      resolve: (g, { you }) => {
        const p = g.players[you];
        const at = p.library.findIndex((c) => isCreature(g, c) || isPlaneswalker(g, c));
        const revealed = at < 0 ? [...p.library] : p.library.slice(0, at + 1);
        if (!revealed.length) return;
        log(g, `${says(p, 'reveals')} ${revealed.map(label).join(', ')}.`, you, revealed);
        const hit = at < 0 ? undefined : revealed[at];
        if (hit) enterBattlefield(g, hit, { controller: you });
        putOnBottomRandomly(
          g,
          revealed.filter((c) => c !== hit),
        );
      },
    },
  },

  'Urza, Lord High Artificer': {
    // 'When Urza enters, create a 0/0 colorless Construct artifact creature token with "This
    // token gets +1/+1 for each artifact you control."'
    onEnter: (g, { you }) => void createToken(g, you, 'Construct 0/0 artifacts'),
    // "Tap an untapped artifact you control: Add {U}." No {T}: Urza isn't tapped, and the
    // artifact's own {T} isn't used, so a new artifact creature can be tapped (302.6).
    mana: { amount: 1, colors: ['U'], noTap: true, tapCreature: { type: 'Artifact' } },
    // "{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that
    // card without paying its mana cost." A land is played as the turn's land (305.2a).
    activated: {
      cost: { mana: '{5}' },
      text: '{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost.',
      resolve: (g, { you }) => {
        const p = g.players[you];
        shuffle(g, p.library);
        const top = p.library[0];
        if (!top) return;
        log(g, `${says(p, 'exiles')} ${label(top)} from the top of ${their(p)} library.`, you, [top]);
        moveCard(g, top, 'exile');
        if (top.zone === 'exile') addEffect(g, { kind: 'mayCast', player: you, card: top.id, moves: top.moves, play: true, free: true });
      },
    },
  },

  'Sisay, Weatherlight Captain': {
    // "Sisay gets +1/+1 for each color among other legendary permanents you control." (613.4c, 105.2)
    static: (g, self, c) => {
      if (c.id !== self.id) return null;
      const n = colorsAmong(g, self.controller, (x) => x.id !== self.id && hasType(g, x, 'Legendary')).length;
      return n ? { power: n, toughness: n } : null;
    },
    // "{W}{U}{B}{R}{G}: Search your library for a legendary permanent card with mana value less
    // than Sisay's power, put that card onto the battlefield, then shuffle." Its power as the
    // ability resolves, or as it last was if it has left (608.2h).
    activated: {
      cost: { mana: '{W}{U}{B}{R}{G}' },
      text: "{W}{U}{B}{R}{G}: Search your library for a legendary permanent card with mana value less than Sisay's power, put that card onto the battlefield, then shuffle.",
      resolve: (g, { self, you }) => {
        const most = stats(g, self).power - 1;
        search(g, you, 'battlefield', { legendary: true, types: PERMANENT_TYPES, maxMv: most, label: `a legendary permanent card with mana value ${Math.max(most, 0)} or less` });
      },
    },
  },

  'Mana Drain': {
    // "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal
    // to that spell's mana value." The delayed trigger (603.7) is made whether or not the spell
    // could be countered; with its target gone, Mana Drain does nothing at all (608.2b).
    targets: [anySpell],
    onResolve: (g, { self, you, targets }) => {
      const item = refStack(g, targets[0]);
      if (!item) return;
      // As it is on the stack, X included (202.3e).
      const mv = manaValue(item.card);
      counter(g, targets[0]);
      delay(g, self, you, { key: 'drain', step: 'main', player: you, data: { mv } });
    },
    delayed: { drain: (g, { self, you, data: d }) => addMana(g, you, Array.from({ length: d.mv as number }, () => 'C' as const), self) },
  },
};

registerScripts(scripts);
