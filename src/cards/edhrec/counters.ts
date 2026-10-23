// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (counters group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care. The keyword actions
// and counters they share are the engine's: proliferate (701.34), blight (701.68), counters on
// players (122.1, rad counters 728), moving a counter (122.5) and decayed (702.147).
import { registerScripts } from '../../engine/registry';
import {
  addCounters,
  addPlayerCounters,
  ask,
  counterCount,
  counterKinds,
  createToken,
  didThisTurn,
  dieMany,
  draw,
  eachBlights,
  enterBattlefield,
  has,
  hasType,
  isArriving,
  isCreature,
  label,
  loseLife,
  manaValue,
  markDid,
  mill,
  moveCard,
  moveCounter,
  nameCard,
  opponentsOf,
  permanent,
  pickCards,
  playerCounters,
  proliferate,
  refCard,
  refGraveyard,
  simultaneously,
  subtypesOf,
  turnOrder,
} from '../../engine/rules';
import type { Card, Game, PlayerId, TargetSpec } from '../../engine/types';

/** "At the beginning of your end step" (513.1): the end step of this permanent's controller. */
const yourEndStep = (_g: Game, e: { self: Card; player: PlayerId }) => e.player === e.self.controller;

/** The permanent an event named, if it is still the same object (400.7), else as it last was (608.2h). */
const nowOrThen = (g: Game, c: Card): Card => {
  const now = permanent(g, c.id);
  return now && now.moves === c.moves ? now : c;
};

/** A nonland card milled, where it went (701.17c). */
const nonland = (g: Game, cards: Card[]) => cards.filter((c) => !hasType(g, c, 'Land'));

/** Each player gets a rad counter (122.1i), in turn order. */
const eachPlayerGetsRad = (g: Game) => {
  for (const pid of turnOrder(g, g.active)) addPlayerCounters(g, pid, 1, 'rad');
};

/** Tidus's "Do this only once each turn" (603.2h), by player. */
const CHEER = "Tidus, Yuna's Guardian: draw and proliferate";

const youControl = (label: string, extra: Partial<TargetSpec> = {}): TargetSpec => ({ type: 'creature', who: 'you', label, ...extra });

registerScripts({
  "Atraxa, Praetors' Voice": {
    // "At the beginning of your end step, proliferate."
    onEndStep: { when: yourEndStep, resolve: (g, { you }) => void proliferate(g, you), text: 'At the beginning of your end step, proliferate.' },
  },

  'Kilo, Apogee Mind': {
    // "Whenever Kilo becomes tapped, proliferate." (603.2e: only as it changes from untapped to tapped.)
    onTapped: (g, { you }) => void proliferate(g, you),
  },

  "Tidus, Yuna's Guardian": {
    // "At the beginning of combat on your turn, you may move a counter from target creature you
    // control onto a second target creature you control." Two instances of "target": the same
    // creature may be chosen for both (115.3), and then no counter moves (122.5).
    onBeginCombat: {
      when: (_g, { self, player }) => player === self.controller,
      targets: [youControl('target creature you control (to move a counter from)'), youControl('a second target creature you control (to move it onto)')],
      resolve: (g, { you, targets }) => {
        const from = refCard(g, targets[0]);
        const to = refCard(g, targets[1]);
        // With either target gone or illegal, it's not possible to move a counter (122.5).
        if (!from || !to || from.id === to.id || !counterKinds(from.counters).length) return;
        ask(g, you, { text: `Move a counter from ${label(from)} onto ${label(to)}?`, yes: 'Move', no: "Don't Move", then: 'move', data: { from: from.id, to: to.id } });
      },
      text: 'At the beginning of combat on your turn, you may move a counter from target creature you control onto a second target creature you control.',
    },
    // "Cheer — Whenever one or more creatures you control with counters on them deal combat damage
    // to a player, you may draw a card and proliferate. Do this only once each turn." It triggers
    // only if you haven't drawn and proliferated with it this turn (603.2h); once for each player
    // dealt that damage (603.2c), and one waiting as you take the action does nothing.
    onPlayerDealtCombatDamage: {
      when: (g, { self, sources }) => !didThisTurn(g, self.controller, CHEER) && sources.some((c) => c.controller === self.controller && counterKinds(c.counters).length > 0),
      resolve: (g, { you }) => {
        if (didThisTurn(g, you, CHEER)) return;
        ask(g, you, { text: 'You may draw a card and proliferate (once each turn).', yes: 'Draw and Proliferate', no: "Don't", then: 'cheer' });
      },
      text: 'Cheer — Whenever one or more creatures you control with counters on them deal combat damage to a player, you may draw a card and proliferate. Do this only once each turn.',
    },
    then: {
      move: (g, { yes, data, you }) => {
        const from = permanent(g, data.from as string);
        const to = permanent(g, data.to as string);
        if (!yes || !from || !to) return;
        const kinds = counterKinds(from.counters);
        // "A counter": its controller chooses which kind, when it has more than one (122.5).
        if (kinds.length === 1) moveCounter(g, from, to, kinds[0]);
        else if (kinds.length > 1) nameCard(g, you, { text: `Choose the kind of counter to move from ${label(from)} onto ${label(to)}.`, of: 'counter', options: kinds, then: 'moveKind', data });
      },
      moveKind: (g, { name, data }) => void moveCounter(g, permanent(g, data.from as string), permanent(g, data.to as string), name),
      cheer: (g, { yes, you }) => {
        if (!yes || didThisTurn(g, you, CHEER)) return;
        markDid(g, you, CHEER);
        draw(g, you);
        proliferate(g, you);
      },
    },
    botChoice: {
      // A bot spreads its counters: one moves from a creature with several onto one with none,
      // so more of its creatures have counters for Cheer.
      move: (g, _pid, choice) => {
        const d = (choice as { data?: Record<string, unknown> }).data ?? {};
        const from = permanent(g, d.from as string);
        const to = permanent(g, d.to as string);
        const total = (c: Card) => Object.values(c.counters).reduce((n, k) => n + k, 0);
        return { type: 'answer', yes: !!from && !!to && counterCount(from) >= 2 && total(to) === 0 };
      },
    },
  },

  'High Perfect Morcant': {
    // "Whenever High Perfect Morcant or another Elf you control enters, each opponent blights 1."
    onPermanentEnters: {
      when: (g, { self, entered }) => entered.id === self.id || (entered.controller === self.controller && subtypesOf(g, entered).includes('Elf')),
      resolve: (g, { you }) =>
        eachBlights(
          g,
          opponentsOf(g, you).map((p) => p.id),
          1,
        ),
      text: 'Whenever High Perfect Morcant or another Elf you control enters, each opponent blights 1.',
    },
    // "Tap three untapped Elves you control: Proliferate. Activate only as a sorcery." Not {T}:
    // Morcant may be one of them, summoning sick or not (302.6).
    activated: {
      cost: { tapUntapped: { type: '', subtype: 'Elf', count: 3, label: 'three untapped Elves you control' } },
      sorcery: true,
      text: 'Tap three untapped Elves you control: Proliferate',
      resolve: (g, { you }) => void proliferate(g, you),
    },
  },

  'Auntie Ool, Cursewretch': {
    // "Ward—Blight 2." (702.21a, 701.68a)
    ward: { blight: 2 },
    // "Whenever one or more -1/-1 counters are put on a creature, draw a card if you control that
    // creature. If you don't control it, its controller loses 1 life." Who controls it is checked
    // as it resolves; if it has left the battlefield, as it last was (608.2h).
    onCountersPut: {
      when: (g, { kind, card }) => kind === '-1/-1' && isCreature(g, card),
      resolve: (g, { you, card }) => {
        const c = nowOrThen(g, card);
        if (c.controller === you) draw(g, you);
        else loseLife(g, c.controller, 1);
      },
      text: "Whenever one or more -1/-1 counters are put on a creature, draw a card if you control that creature. If you don't control it, its controller loses 1 life.",
    },
  },

  'The Wise Mothman': {
    // "Whenever The Wise Mothman enters or attacks, each player gets a rad counter."
    onEnter: (g) => eachPlayerGetsRad(g),
    onAttack: (g) => eachPlayerGetsRad(g),
    // "Whenever one or more nonland cards are milled, put a +1/+1 counter on each of up to X
    // target creatures, where X is the number of nonland cards milled this way." Once for each
    // event, whoever milled (603.2c); X is counted from that event.
    onMilled: {
      when: (g, { cards }) => nonland(g, cards).length > 0,
      targets: [
        {
          type: 'creature',
          any: true,
          most: (g, source) => nonland(g, ((source.triggeredBy?.cards as Card[] | undefined) ?? [])).length,
          label: 'up to X target creatures (X: the nonland cards milled)',
        },
      ],
      resolve: (g, { targets }) => {
        for (const t of targets) addCounters(g, refCard(g, t), 1);
      },
      text: 'Whenever one or more nonland cards are milled, put a +1/+1 counter on each of up to X target creatures, where X is the number of nonland cards milled this way.',
    },
  },

  'Meren of Clan Nel Toth': {
    // "Whenever another creature you control dies, you get an experience counter."
    onCreatureDies: {
      when: (_g, { self, dead }) => dead.id !== self.id && dead.controller === self.controller,
      resolve: (g, { you }) => addPlayerCounters(g, you, 1, 'experience'),
      text: 'Whenever another creature you control dies, you get an experience counter.',
    },
    // "At the beginning of your end step, choose target creature card in your graveyard. If that
    // card's mana value is less than or equal to the number of experience counters you have,
    // return it to the battlefield. Otherwise, put it into your hand." Compared as it resolves.
    onEndStep: {
      when: yourEndStep,
      targets: [{ type: 'graveyard card', who: 'you', filter: (g, c) => hasType(g, c, 'Creature'), label: 'target creature card in your graveyard' }],
      resolve: (g, { you, targets }) => {
        const c = refGraveyard(g, targets[0]);
        if (!c) return;
        // It enters under the control of the player who puts it there (110.2a).
        if (manaValue(c) <= playerCounters(g.players[you], 'experience')) enterBattlefield(g, c, { controller: you });
        else moveCard(g, c, 'hand');
      },
      text: "At the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.",
    },
  },

  'Hope Estheim': {
    // "At the beginning of your end step, each opponent mills X cards, where X is the amount of
    // life you gained this turn." X as it resolves; the opponents mill at the same time (101.4).
    onEndStep: {
      when: yourEndStep,
      resolve: (g, { you }) => {
        const x = g.players[you].lifeGained ?? 0;
        if (x > 0) simultaneously(g, () => opponentsOf(g, you).forEach((o) => mill(g, o.id, x)));
      },
      text: 'At the beginning of your end step, each opponent mills X cards, where X is the amount of life you gained this turn.',
    },
  },

  "Betor, Ancestor's Voice": {
    // "At the beginning of your end step, put a number of +1/+1 counters on up to one other target
    // creature you control equal to the amount of life you gained this turn. Return up to one
    // target creature card with mana value less than or equal to the amount of life you lost this
    // turn from your graveyard to the battlefield." The amounts as it resolves; the card's mana
    // value is a targeting condition, checked again then (608.2b).
    onEndStep: {
      when: yourEndStep,
      targets: [
        youControl('up to one other target creature you control', { optional: true, filter: (_g, c, source) => c.id !== source.id }),
        {
          type: 'graveyard card',
          who: 'you',
          optional: true,
          filter: (g, c, source) => hasType(g, c, 'Creature') && manaValue(c) <= g.players[source.controller].lifeLost,
          label: 'up to one target creature card in your graveyard with mana value at most the life you lost this turn',
        },
      ],
      resolve: (g, { you, targets }) => {
        addCounters(g, refCard(g, targets[0]), g.players[you].lifeGained ?? 0);
        const back = refGraveyard(g, targets[1]);
        if (back) enterBattlefield(g, back, { controller: you });
      },
      text: 'At the beginning of your end step, put +1/+1 counters on up to one other target creature you control equal to the life you gained this turn. Return up to one target creature card with mana value at most the life you lost this turn from your graveyard to the battlefield.',
    },
  },

  'Giada, Font of Hope': {
    // "Each other Angel you control enters with an additional +1/+1 counter on it for each Angel
    // you already control." A replacement effect on how it enters (614.1c, 614.12); Angels
    // entering at the same time aren't already controlled.
    replaces: (g, self, ev) => {
      if (ev.kind !== 'enter' || ev.card.id === self.id || ev.card.controller !== self.controller || !subtypesOf(g, ev.card).includes('Angel')) return null;
      const n = g.players[self.controller].battlefield.filter((c) => c.id !== ev.card.id && !isArriving(c.id) && subtypesOf(g, c).includes('Angel')).length;
      return n > 0 ? { instead: { ...ev, counters: { ...ev.counters, '+1/+1': (ev.counters['+1/+1'] ?? 0) + n } } } : null;
    },
    // "{T}: Add {W}. Spend this mana only to cast an Angel spell." (106.6)
    mana: { amount: 1, colors: ['W'], subtype: 'Angel' },
  },

  'Wilhelt, the Rotcleaver': {
    // "Whenever another Zombie you control dies, if it didn't have decayed, create a 2/2 black
    // Zombie creature token with decayed." Both as it last was on the battlefield (603.10a); the
    // "if" is checked again as it resolves (603.4).
    onCreatureDies: {
      when: (g, { self, dead }) => dead.id !== self.id && dead.controller === self.controller && subtypesOf(g, dead).includes('Zombie') && !has(g, dead, 'decayed'),
      resolve: (g, { you, dead }) => {
        if (!has(g, dead, 'decayed')) createToken(g, you, 'Zombie Decayed');
      },
      text: "Whenever another Zombie you control dies, if it didn't have decayed, create a 2/2 black Zombie creature token with decayed.",
    },
    // "At the beginning of your end step, you may sacrifice a Zombie. If you do, draw a card."
    onEndStep: {
      when: yourEndStep,
      resolve: (g, { you }) => {
        const zombies = g.players[you].battlefield.filter((c) => subtypesOf(g, c).includes('Zombie'));
        if (zombies.length) pickCards(g, you, zombies, { min: 0, max: 1, text: 'you may sacrifice a Zombie; if you do, draw a card', button: 'Sacrifice', then: 'sacrifice' });
      },
      text: 'At the beginning of your end step, you may sacrifice a Zombie. If you do, draw a card.',
    },
    then: {
      sacrifice: (g, { you, picked }) => {
        const c = picked[0] && permanent(g, picked[0].id);
        if (!c || c.controller !== you) return;
        dieMany(g, [c], 'is sacrificed');
        // "If you do": it was sacrificed, whether or not it reached the graveyard.
        if (!permanent(g, c.id)) draw(g, you);
      },
    },
    // A bot sacrifices a Zombie token, never a card.
    botChoice: {
      sacrifice: (g, pid) => {
        const token = g.players[pid].battlefield.filter((c) => c.isToken && subtypesOf(g, c).includes('Zombie')).sort((a, b) => Number(has(g, b, 'decayed')) - Number(has(g, a, 'decayed')))[0];
        return { type: 'chooseCards', cards: token ? [token.id] : [] };
      },
    },
  },
});
