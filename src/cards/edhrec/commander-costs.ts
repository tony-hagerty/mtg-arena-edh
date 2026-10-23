// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (commander-costs group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care.
//
// Witherbloom, the Balancer and The First Sliver need no hand script: the parser reads
// "Affinity for creatures", "Cascade", "Sliver spells you cast have cascade." and "Instant and
// sorcery spells you cast have affinity for creatures." (702.41, 702.85).
import { registerToken } from '../db';
import { registerScripts } from '../../engine/registry';
import {
  addCounters,
  ask,
  colorsOf,
  createToken,
  data,
  delay,
  draw,
  enterBattlefield,
  findCard,
  finishEnter,
  gainLife,
  hasType,
  isColor,
  isCreature,
  isPermanentCard,
  label,
  log,
  loseLife,
  manaValue,
  moveCard,
  nameCard,
  ninjutsu,
  opponentsOf,
  parseCost,
  permanent,
  pickCards,
  planPayment,
  sacrifice,
  says,
  simultaneously,
  their,
  tokenCopy,
  untilEndOfTurn,
  verbFor,
} from '../../engine/rules';
import type { Card, Game, PlayerId } from '../../engine/types';
import { favouriteType } from '../kraum-tymna';

// ---------- pieces ----------

/** The permanent `self` still is, if it hasn't left the battlefield since (400.7). */
const still = (g: Game, self: Card): Card | undefined => {
  const c = permanent(g, self.id);
  return c && c.moves === self.moves ? c : undefined;
};

/**
 * Is `self` still the same object (400.7), in the command zone or on the battlefield? For
 * eminence's "if [this] is in the command zone or on the battlefield" (603.4): a commander that
 * went from the battlefield to the command zone meanwhile is a new object, and the ability does
 * nothing, as Edgar Markov's rulings say.
 */
const commandOrBattlefield = (g: Game, self: Card): boolean => {
  const c = findCard(g, self.id);
  return !!c && c.moves === self.moves && (c.zone === 'command' || c.zone === 'battlefield');
};

/** Is `self` still the same card, in its owner's command zone? */
const inCommandZone = (g: Game, self: Card): boolean => {
  const c = findCard(g, self.id);
  return !!c && c.moves === self.moves && c.zone === 'command';
};

/** Edgar Markov's "1/1 black Vampire creature token" (111.4), keyed like the tokens the parser makes. */
const VAMPIRE = 'Vampire 1/1 B';
registerToken(VAMPIRE, {
  name: 'Vampire',
  manaCost: '',
  cmc: 0,
  colors: ['B'],
  colorIdentity: ['B'],
  typeLine: 'Token Creature — Vampire',
  oracleText: '',
  power: '1',
  toughness: '1',
  keywords: [],
  image: '',
  art: '',
});

const WUBRG = '{W}{U}{B}{R}{G}';

registerScripts({
  'Edgar Markov': {
    // First strike and haste are the engine's.
    // "Eminence — Whenever you cast another Vampire spell, if Edgar is in the command zone or on
    // the battlefield, create a 1/1 black Vampire creature token." The ability functions from
    // the command zone (113.6b); its intervening "if" is checked as it triggers and as it
    // resolves (603.4), of the same object (400.7).
    fromCommandZone: ['onCast'],
    onCast: {
      when: (g, { self, card, caster }) => caster === self.controller && card.id !== self.id && hasType(g, card, 'Vampire') && commandOrBattlefield(g, self),
      resolve: (g, { self, you }) => {
        if (commandOrBattlefield(g, self)) createToken(g, you, VAMPIRE);
      },
      text: 'Eminence — Whenever you cast another Vampire spell, if Edgar is in the command zone or on the battlefield, create a 1/1 black Vampire creature token.',
    },
    // "Whenever Edgar attacks, put a +1/+1 counter on each Vampire you control." Every Vampire
    // permanent, as they are when it resolves.
    onAttack: (g, { you }) => {
      for (const c of g.players[you].battlefield.filter((c) => hasType(g, c, 'Vampire'))) addCounters(g, c, 1);
    },
  },

  'The Ur-Dragon': {
    // Flying is the engine's.
    // "Eminence — As long as The Ur-Dragon is in the command zone or on the battlefield, other
    // Dragon spells you cast cost {1} less to cast." A cost change that functions from the
    // command zone (113.6b, 601.2f). "Other": not The Ur-Dragon itself.
    fromCommandZone: ['costModifier'],
    costModifier: (g, self, spell, caster) => (caster === self.controller && spell.id !== self.id && hasType(g, spell, 'Dragon') ? -1 : 0),
    // "Whenever one or more Dragons you control attack, draw that many cards, then you may put a
    // permanent card from your hand onto the battlefield." Once for the declaration (508.1m), for
    // the Dragons declared as attackers, even ones gone by the time it resolves (its rulings); a
    // Dragon put onto the battlefield attacking never "attacked" (508.4). One card at most.
    onAttackersDeclared: {
      when: (g, { self, player, attacks }) => player === self.controller && attacks.some((a) => a.attacker.controller === self.controller && hasType(g, a.attacker, 'Dragon')),
      resolve: (g, { self, you, attacks }) => {
        const n = attacks.filter((a) => a.attacker.controller === self.controller && hasType(g, a.attacker, 'Dragon')).length;
        draw(g, you, n);
        const cards = g.players[you].hand.filter((c) => isPermanentCard(g, c));
        if (cards.length) pickCards(g, you, cards, { min: 0, max: 1, text: 'You may put a permanent card from your hand onto the battlefield.', button: 'Put Onto the Battlefield', then: 'urDragon' });
      },
      text: 'Whenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield.',
    },
    then: {
      urDragon: (g, { you, picked }) => {
        const c = picked[0] && g.players[you].hand.find((x) => x.id === picked[0].id);
        if (c) enterBattlefield(g, c, { controller: you });
      },
    },
  },

  'Oloro, Ageless Ascetic': {
    // Its last ability functions from the command zone (113.6b); the other two only on the battlefield.
    fromCommandZone: ['onUpkeep'],
    onUpkeep: [
      // "At the beginning of your upkeep, you gain 2 life."
      {
        when: (_g, { self, player }) => player === self.controller && self.zone === 'battlefield',
        resolve: (g, { you }) => gainLife(g, you, 2),
        text: 'At the beginning of your upkeep, you gain 2 life.',
      },
      // "At the beginning of your upkeep, if Oloro is in the command zone, you gain 2 life." An
      // intervening "if" (603.4): checked as it triggers and as it resolves.
      {
        when: (g, { self, player }) => player === self.controller && inCommandZone(g, self),
        resolve: (g, { self, you }) => {
          if (inCommandZone(g, self)) gainLife(g, you, 2);
        },
        text: 'At the beginning of your upkeep, if Oloro is in the command zone, you gain 2 life.',
      },
    ],
    // "Whenever you gain life, you may pay {1}. If you do, draw a card and each opponent loses 1
    // life." Once for each life-gaining event; the payment is chosen as it resolves (118.12).
    onLifeGain: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => ask(g, you, { text: 'Pay {1} to draw a card and have each opponent lose 1 life?', cost: '{1}', yes: 'Pay {1}', no: "Don't Pay", then: 'oloro' }),
      text: 'Whenever you gain life, you may pay {1}. If you do, draw a card and each opponent loses 1 life.',
    },
    then: {
      oloro: (g, { you, yes }) => {
        if (!yes) return;
        draw(g, you);
        // "Each opponent loses 1 life": one event (603.2c).
        simultaneously(g, () => {
          for (const o of opponentsOf(g, you)) loseLife(g, o.id, 1);
        });
      },
    },
  },

  "Yuriko, the Tiger's Shadow": {
    // "Commander ninjutsu {U}{B}" (702.49d): from the hand or the command zone. Activating it
    // isn't casting Yuriko: no commander tax, and none added (903.8).
    activated: ninjutsu('{U}{B}', true),
    // "Whenever a Ninja you control deals combat damage to a player, reveal the top card of your
    // library and put that card into your hand. Each opponent loses life equal to that card's
    // mana value." Once for each Ninja and each player it damages. The card's mana value as
    // revealed: X in a library counts as 0 (202.3b, its rulings).
    onDamage: {
      when: (g, { self, source, player, combat }) => combat && player !== null && source.controller === self.controller && hasType(g, source, 'Ninja'),
      resolve: (g, { you }) => {
        const p = g.players[you];
        const top = p.library[0];
        if (!top) return;
        const mv = manaValue(top);
        log(g, `${says(p, 'reveals')} ${label(top)} (mana value ${mv}) and ${verbFor(p, 'puts')} it into ${their(p)} hand.`, you, [top]);
        moveCard(g, top, 'hand');
        // "Each opponent loses life equal to that card's mana value": one event (603.2c).
        simultaneously(g, () => {
          for (const o of opponentsOf(g, you)) loseLife(g, o.id, mv);
        });
      },
      text: "Whenever a Ninja you control deals combat damage to a player, reveal the top card of your library and put that card into your hand. Each opponent loses life equal to that card's mana value.",
    },
  },

  'Henzie "Toolbox" Torre': {
    // "Each creature spell you cast with mana value 4 or greater has blitz. The blitz cost is
    // equal to its mana cost." An alternative cost the spell gains as it is cast (118.9,
    // 702.152a). The spell's mana value on the stack counts the X announced with it (202.3e),
    // and the blitz cost is announced together with X (601.2b): a creature with {X} in its cost
    // has blitz only with an X that brings its mana value to 4 (`minX`). A modal double-faced
    // card's back face counts by its own cost (its rulings).
    grantsAlternativeCosts: (g, self, spell, caster) => {
      if (caster !== self.controller || !isCreature(g, spell)) return [];
      const mv = manaValue(spell);
      const xs = parseCost(data(spell).manaCost).x;
      if (mv < 4 && !xs) return [];
      const minX = mv >= 4 ? 0 : Math.ceil((4 - mv) / xs);
      return [{ label: `Blitz ${data(spell).manaCost}`, mana: data(spell).manaCost, blitz: true, ...(minX ? { minX } : {}) }];
    },
    // "Blitz costs you pay cost {1} less for each time you've cast your commander from the
    // command zone this game." Generic mana only (601.2f). With two commanders, casts of either
    // count ("your commander" names each, 903.3d).
    costModifier: (g, self, _spell, caster, _from, alt) => (alt?.blitz && caster === self.controller ? -g.players[caster].commanderCasts.reduce((n, k) => n + k, 0) : 0),
  },

  "K'rrik, Son of Yawgmoth": {
    // Lifelink is the engine's.
    // "For each {B} in a cost, you may pay 2 life rather than pay that mana." Any cost you pay
    // (its rulings): the engine pays each {B} like {B/P}.
    lifeForMana: (_g, self, pid) => (pid === self.controller ? ['B'] : []),
    // "Whenever you cast a black spell, put a +1/+1 counter on K'rrik." On K'rrik if it is still
    // the same object (400.7).
    onCast: {
      when: (g, { self, card, caster }) => caster === self.controller && isColor(g, card, 'B'),
      resolve: (g, { self }) => addCounters(g, still(g, self), 1),
      text: "Whenever you cast a black spell, put a +1/+1 counter on K'rrik.",
    },
  },

  'Morophon, the Boundless': {
    // Changeling is the engine's (702.73).
    // "As Morophon enters, choose a creature type." A replacement effect (614.12a): chosen before
    // it is on the battlefield.
    replaceEnter: (g, c, controller) => {
      nameCard(g, controller, { text: 'Choose a creature type.', of: 'creature type', then: 'type', script: c.id });
      return true;
    },
    then: { type: (g, { self, name, data: d }) => finishEnter(g, self, d, { chosen: name }) },
    // "Spells of the chosen type you cast cost {W}{U}{B}{R}{G} less to cast. This effect reduces
    // only the amount of colored mana you pay." One mana of each colour off the coloured symbols
    // (118.7c, 118.7e-f), and nothing off generic mana.
    reducesColoredCost: (g, self, spell, caster) => (self.chosen && caster === self.controller && hasType(g, spell, self.chosen) ? { colors: ['W', 'U', 'B', 'R', 'G'], coloredOnly: true } : null),
    // "Other creatures you control of the chosen type get +1/+1."
    static: (g, self, c) => (self.chosen && c.id !== self.id && c.controller === self.controller && isCreature(g, c) && hasType(g, c, self.chosen) ? { power: 1, toughness: 1 } : null),
    // A bot names the creature type most common in its deck.
    botChoice: { type: (g, pid) => ({ type: 'name', name: favouriteType(g, pid) }) },
  },

  'Zhulodok, Void Gorger': {
    // "Colorless spells you cast from your hand with mana value 7 or greater have 'Cascade,
    // cascade.'" Two instances, each triggering on its own (702.85c). The spell's mana value is as
    // cast, X counted (202.3e).
    grantsCascade: (g, self, spell, caster, from) => (caster === self.controller && from === 'hand' && colorsOf(g, spell).length === 0 && manaValue(spell) >= 7 ? 2 : 0),
  },

  'Ashling, the Limitless': {
    // "Elemental permanent spells you cast from your hand gain evoke {4} as you cast them." An
    // alternative cost gained as the spell is cast (702.74a, 118.9); the permanent is then
    // sacrificed as it enters even if Ashling has left (its rulings: `CastInfo.evoke`).
    grantsAlternativeCosts: (g, self, spell, caster, from) =>
      caster === self.controller && from === 'hand' && isPermanentCard(g, spell) && hasType(g, spell, 'Elemental') ? [{ label: 'Evoke {4}', mana: '{4}', evoke: true }] : [],
    // "Whenever you sacrifice a nontoken Elemental, create a token that's a copy of it. The token
    // gains haste until end of turn. At the beginning of your next end step, sacrifice it unless
    // you pay {W}{U}{B}{R}{G}." The Elemental as it last was (603.10a); the copy is of its
    // copiable values (707.2). The payment is that player's choice as the delayed trigger
    // resolves (118.12a).
    onSacrifice: {
      when: (g, { self, card, player }) => player === self.controller && !card.isToken && hasType(g, card, 'Elemental'),
      resolve: (g, { self, you, card }) => {
        const token = tokenCopy(g, you, card);
        if (!token) return;
        untilEndOfTurn(g, token, { keywords: ['haste'] });
        delay(g, self, you, { key: 'ashling', step: 'end', player: you, data: { id: token.id, moves: token.moves } });
      },
      text: "Whenever you sacrifice a nontoken Elemental, create a token that's a copy of it. The token gains haste until end of turn. At the beginning of your next end step, sacrifice it unless you pay {W}{U}{B}{R}{G}.",
    },
    delayed: {
      ashling: (g, { you, data: d }) => {
        const token = permanent(g, d.id as string);
        if (!token || token.moves !== d.moves) return;
        ask(g, you, { text: `Pay ${WUBRG}, or sacrifice ${label(token)}?`, cost: WUBRG, yes: `Pay ${WUBRG}`, no: 'Sacrifice It', then: 'ashlingPay', data: d });
      },
    },
    then: {
      ashlingPay: (g, { yes, data: d }) => {
        const token = permanent(g, d.id as string);
        if (!yes && token && token.moves === d.moves) sacrifice(g, token);
      },
    },
    // A bot keeps the copy whenever it can pay.
    botChoice: { ashlingPay: (g, pid: PlayerId) => ({ type: 'answer', yes: !!planPayment(g, pid, parseCost(WUBRG)) }) },
  },
});
