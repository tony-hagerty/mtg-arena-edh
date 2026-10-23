// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (library group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care.
//
// The parser reads the rest of the group itself: Ureni of the Unwritten, Atla Palani, Nekusar,
// Xyris and Damn (see tests/edhrec-library.test.ts).
import { registerToken } from '../db';
import { registerScripts } from '../../engine/registry';
import {
  abilitySource,
  ask,
  castFromExiled,
  counterCount,
  createToken,
  didThisTurn,
  discover,
  enterBattlefield,
  enterTogether,
  exileUntil,
  hasType,
  isCreature,
  isLand,
  isSaga,
  label,
  log,
  manaValue,
  markDid,
  mill,
  moveCard,
  permanent,
  pickCards,
  pump,
  putOnBottomRandomly,
  refGraveyard,
  revealUntil,
  says,
  stats,
  subtypesOf,
  their,
  toGraveyards,
} from '../../engine/rules';
import type { Action, Card, CardData, Choice, Color, Game, PlayerId } from '../../engine/types';

// ---------- pieces ----------

const isOpponent = (g: Game, a: PlayerId, b: PlayerId | null) => b !== null && a !== b && !g.players[b].lost;

/** A creature token the text describes (111.4), registered under the key the Oracle text parser gives the same words: "Zombie Druid 2/2 B". */
function creatureToken(types: string, power: number, toughness: number, colors: Color[]): string {
  const key = `${types} ${power}/${toughness} ${colors.join('') || 'C'}`;
  const d: CardData = {
    name: types,
    manaCost: '',
    cmc: 0,
    colors,
    colorIdentity: colors,
    typeLine: `Token Creature — ${types}`,
    oracleText: '',
    power: String(power),
    toughness: String(toughness),
    keywords: [],
    image: '',
    art: '',
  };
  registerToken(key, d);
  return key;
}
const ZOMBIE_DRUID = creatureToken('Zombie Druid', 2, 2, ['B']);

/** Is `c` a creature card (or creature) with one of these creature types, as it is where it is (205.3m, 702.73a)? */
const creatureOfType = (g: Game, c: Card, types: string[]) => hasType(g, c, 'Creature') && subtypesOf(g, c).some((t) => types.includes(t));

/** The cards with these ids still in `pid`'s library, in the order of `ids`. */
const stillInLibrary = (g: Game, pid: PlayerId, ids: string[]) => ids.map((id) => g.players[pid].library.find((c) => c.id === id)).filter((c): c is Card => !!c);

/** A bot picks every card it may: putting permanents onto the battlefield for free is always worth it. */
const pickAll = (_g: Game, _pid: PlayerId, choice: Choice): Action => ({ type: 'chooseCards', cards: choice.kind === 'pick' ? (choice.pickable ?? choice.cards) : [] });

/** The lore counters among Sagas `pid` controls (Tom Bombadil). */
const loreAmongSagas = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter((c) => isSaga(g, c)).reduce((n, c) => n + counterCount(c, 'lore'), 0);

/** The legendary creatures `pid` controls (Jodah). */
const legendaryCreatures = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter((c) => hasType(g, c, 'Legendary') && isCreature(g, c)).length;

registerScripts({
  'Kaalia of the Vast': {
    // "Whenever Kaalia attacks an opponent": attacking that player, not a planeswalker or
    // battle (506.3, 508.1b), so it doesn't trigger then.
    onAttack: {
      when: (g, { self, defender, target }) => target === null && isOpponent(g, self.controller, defender),
      resolve: (g, { you, defender }) => {
        // "You may put an Angel, Demon, or Dragon creature card from your hand onto the battlefield tapped and attacking that opponent."
        const fits = g.players[you].hand.filter((c) => creatureOfType(g, c, ['Angel', 'Demon', 'Dragon']));
        if (!fits.length) return;
        pickCards(g, you, fits, { min: 0, max: 1, text: 'you may put an Angel, Demon, or Dragon creature card from your hand onto the battlefield tapped and attacking', button: 'Put onto Battlefield', then: 'kaalia', data: { defender } });
      },
      text: 'Whenever Kaalia attacks an opponent, you may put an Angel, Demon, or Dragon creature card from your hand onto the battlefield tapped and attacking that opponent.',
    },
    then: {
      kaalia: (g, { you, picked, data }) => {
        const c = picked[0] && g.players[you].hand.find((x) => x.id === picked[0].id);
        if (!c) return;
        log(g, `${says(g.players[you], 'puts')} ${label(c)} onto the battlefield tapped and attacking ${g.players[data.defender as PlayerId].name}.`, you, [c]);
        // Attacking "that opponent" (508.4): it never attacked, so "whenever ... attacks" doesn't trigger for it.
        enterBattlefield(g, c, { tapped: true, attacking: { defender: data.defender as PlayerId } });
      },
    },
  },

  'Teval, the Balanced Scale': {
    // "Whenever Teval attacks, mill three cards. Then you may return a land card from your
    // graveyard to the battlefield tapped." Not a target: the land is chosen as it resolves,
    // and the cards just milled are among those it may be.
    onAttack: (g, { you }) => {
      mill(g, you, 3);
      const lands = g.players[you].graveyard.filter((c) => isLand(g, c));
      if (lands.length) pickCards(g, you, lands, { min: 0, max: 1, text: 'you may return a land card from your graveyard to the battlefield tapped', button: 'Return', then: 'land' });
    },
    // "Whenever one or more cards leave your graveyard, create a 2/2 black Zombie Druid
    // creature token." Once for each event, however many cards leave in it (603.2c, 603.10a).
    onLeaveGraveyard: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => void createToken(g, you, ZOMBIE_DRUID),
      text: 'Whenever one or more cards leave your graveyard, create a 2/2 black Zombie Druid creature token.',
    },
    then: {
      land: (g, { you, picked }) => {
        const c = picked[0] && g.players[you].graveyard.find((x) => x.id === picked[0].id);
        if (c) enterBattlefield(g, c, { tapped: true });
      },
    },
    botChoice: { land: pickAll },
  },

  "Gishath, Sun's Avatar": {
    // "Whenever Gishath deals combat damage to a player, reveal that many cards from the top
    // of your library. Put any number of Dinosaur creature cards from among them onto the
    // battlefield and the rest on the bottom of your library in a random order."
    onCombatDamageToPlayer: (g, { you, amount }) => {
      const p = g.players[you];
      const revealed = p.library.slice(0, amount);
      if (!revealed.length) return;
      log(g, `${says(p, 'reveals')} ${revealed.map(label).join(', ')}.`, you, revealed);
      const dinosaurs = revealed.filter((c) => creatureOfType(g, c, ['Dinosaur']));
      if (!dinosaurs.length) return putOnBottomRandomly(g, revealed);
      pickCards(g, you, revealed, {
        min: 0,
        max: dinosaurs.length,
        pickable: dinosaurs,
        text: 'put any number of Dinosaur creature cards onto the battlefield (the rest go on the bottom of your library in a random order)',
        button: 'Put onto Battlefield',
        then: 'dinosaurs',
        data: { revealed: revealed.map((c) => c.id) },
      });
    },
    then: {
      dinosaurs: (g, { you, picked, data }) => {
        const chosen = stillInLibrary(g, you, picked.map((c) => c.id));
        const rest = stillInLibrary(g, you, data.revealed as string[]).filter((c) => !chosen.some((x) => x.id === c.id));
        // Onto the battlefield together, so each sees the others enter (603.6a).
        if (chosen.length) enterTogether(g, chosen.map((card) => ({ card })));
        putOnBottomRandomly(g, rest.filter((c) => c.zone === 'library'));
      },
    },
    botChoice: { dinosaurs: pickAll },
  },

  'Choco, Seeker of Paradise': {
    // "Whenever one or more Birds you control attack, look at that many cards from the top of
    // your library." Once, after attackers are declared (508.1m); "that many" is how many Birds you control attacked.
    onAttackersDeclared: {
      when: (g, { self, attacks }) => attacks.some((a) => a.attacker.controller === self.controller && creatureOfType(g, a.attacker, ['Bird'])),
      resolve: (g, { you, self, attacks }) => {
        const birds = attacks.filter((a) => a.attacker.controller === self.controller && creatureOfType(g, a.attacker, ['Bird'])).length;
        const top = g.players[you].library.slice(0, birds);
        if (!top.length) return;
        log(g, `${says(g.players[you], 'looks')} at the top ${top.length === 1 ? 'card' : `${top.length} cards`} of ${their(g.players[you])} library.`, you);
        // "You may put one of them into your hand."
        pickCards(g, you, top, { min: 0, max: 1, text: 'you may put one of them into your hand', button: 'Put in Hand', then: 'hand', data: { top: top.map((c) => c.id) } });
      },
      text: 'Whenever one or more Birds you control attack, look at that many cards from the top of your library.',
    },
    // "Landfall — Whenever a land you control enters, Choco gets +1/+0 until end of turn."
    onLandfall: {
      when: (_g, { self, land }) => land.controller === self.controller,
      resolve: (g) => pump(g, abilitySource(g), 1, 0),
      text: 'Landfall — Whenever a land you control enters, Choco gets +1/+0 until end of turn.',
    },
    then: {
      hand: (g, { you, picked, data }) => {
        const p = g.players[you];
        const kept = stillInLibrary(g, you, picked.map((c) => c.id));
        for (const c of kept) moveCard(g, c, 'hand');
        if (kept.length) log(g, `${says(p, 'puts')} a card into ${their(p)} hand.`, you, [], { players: [you], text: `${says(p, 'puts')} ${label(kept[0])} into ${their(p)} hand.`, cards: kept });
        // "Then put any number of land cards from among them onto the battlefield tapped and the rest into your graveyard."
        const rest = stillInLibrary(g, you, data.top as string[]);
        const lands = rest.filter((c) => isLand(g, c));
        if (!lands.length) return toGraveyards(g, rest);
        pickCards(g, you, rest, { min: 0, max: lands.length, pickable: lands, text: 'put any number of land cards onto the battlefield tapped (the rest go into your graveyard)', button: 'Put onto Battlefield', then: 'lands', data: { rest: rest.map((c) => c.id) } });
      },
      lands: (g, { you, picked, data }) => {
        const chosen = stillInLibrary(g, you, picked.map((c) => c.id));
        const rest = stillInLibrary(g, you, data.rest as string[]).filter((c) => !chosen.some((x) => x.id === c.id));
        if (chosen.length) enterTogether(g, chosen.map((card) => ({ card, opts: { tapped: true } })));
        toGraveyards(g, rest.filter((c) => c.zone === 'library'));
      },
    },
    botChoice: { lands: pickAll },
  },

  'Tom Bombadil': {
    // "As long as there are four or more lore counters among Sagas you control, Tom Bombadil
    // has hexproof and indestructible." (611.3a: it applies while the condition holds.)
    static: (g, self, c) => (c.id === self.id && loreAmongSagas(g, self.controller) >= 4 ? { keywords: ['hexproof', 'indestructible'] } : null),
    // "Whenever the final chapter ability of a Saga you control resolves, reveal cards from
    // the top of your library until you reveal a Saga card. Put that card onto the battlefield
    // and the rest on the bottom of your library in a random order. This ability triggers only
    // once each turn."
    onChapterResolved: {
      when: (_g, { self, final, controller }) => final && controller === self.controller,
      oncePerTurn: true,
      resolve: (g, { you }) => {
        const { hit, revealed } = revealUntil(g, you, (c) => hasType(g, c, 'Saga'), 'a Saga card');
        if (hit) enterBattlefield(g, hit);
        putOnBottomRandomly(g, revealed.filter((c) => c.id !== hit?.id && c.zone === 'library'));
      },
      text: 'Whenever the final chapter ability of a Saga you control resolves, reveal cards from the top of your library until you reveal a Saga card.',
    },
  },

  'Pantlaza, Sun-Favored': {
    // "Whenever Pantlaza or another Dinosaur you control enters, you may discover X, where X
    // is that creature's toughness. Do this only once each turn." It triggers only while its
    // controller hasn't discovered with it this turn (603.2h), and checks again as it resolves.
    onCreatureEnters: {
      when: (g, { self, entered }) =>
        (entered.id === self.id || (entered.controller === self.controller && creatureOfType(g, entered, ['Dinosaur']))) && !didThisTurn(g, self.controller, 'Pantlaza'),
      resolve: (g, { you, entered }) => {
        if (didThisTurn(g, you, 'Pantlaza')) return;
        // Its toughness now, or as it last was on the battlefield (608.2h).
        const now = permanent(g, entered.id);
        const x = Math.max(0, stats(g, now && now.moves === entered.moves ? now : entered).toughness);
        ask(g, you, { text: `Discover ${x}? (Exile cards from the top of your library until you exile a nonland card with mana value ${x} or less, then cast it free or put it into your hand.)`, yes: `Discover ${x}`, no: "Don't Discover", then: 'discover', data: { x } });
      },
      text: "Whenever Pantlaza or another Dinosaur you control enters, you may discover X, where X is that creature's toughness. Do this only once each turn.",
    },
    then: {
      discover: (g, { you, yes, data }) => {
        if (!yes || didThisTurn(g, you, 'Pantlaza')) return;
        markDid(g, you, 'Pantlaza');
        discover(g, you, data.x as number);
      },
    },
  },

  'Jodah, the Unifier': {
    // "Legendary creatures you control get +X/+X, where X is the number of legendary creatures
    // you control." X is counted whenever it applies (611.3a), in layer 7c (613.4c).
    static: (g, self, c) => {
      if (c.controller !== self.controller || !hasType(g, c, 'Legendary') || !isCreature(g, c)) return null;
      const x = legendaryCreatures(g, self.controller);
      return { power: x, toughness: x };
    },
    // "Whenever you cast a legendary spell from your hand, exile cards from the top of your
    // library until you exile a legendary nonland card with lesser mana value. You may cast
    // that card without paying its mana cost. Put the rest on the bottom of your library in a
    // random order." Lesser than the spell's mana value, X included (202.3e), as it was cast
    // (608.2h). A card that isn't cast is one of the rest.
    onCast: {
      when: (g, { self, caster, card }) => caster === self.controller && card.cast?.from === 'hand' && hasType(g, card, 'Legendary'),
      resolve: (g, { you, card }) => {
        const mv = manaValue(card);
        const { hit, rest } = exileUntil(g, you, (c) => hasType(g, c, 'Legendary') && !isLand(g, c) && manaValue(c) < mv);
        castFromExiled(g, you, hit, rest, { text: hit ? `You may cast ${label(hit)} without paying its mana cost.` : '' });
      },
      text: 'Whenever you cast a legendary spell from your hand, exile cards from the top of your library until you exile a legendary nonland card with lesser mana value.',
    },
  },

  "Captain N'ghathrod": {
    // "Horrors you control have menace." (613.1f) Horror is a creature type (205.3m).
    static: (g, self, c) => (c.controller === self.controller && subtypesOf(g, c).includes('Horror') ? { keywords: ['menace'] } : null),
    // "Whenever a Horror you control deals combat damage to a player, that player mills that many cards."
    onDamage: {
      when: (g, { self, source, player, combat }) => combat && player !== null && source.controller === self.controller && subtypesOf(g, source).includes('Horror'),
      resolve: (g, { player, amount }) => {
        if (player !== null && !g.players[player].lost) mill(g, player, amount);
      },
      text: 'Whenever a Horror you control deals combat damage to a player, that player mills that many cards.',
    },
    // "At the beginning of your end step, choose target artifact or creature card in an
    // opponent's graveyard that was put there from their library this turn. Put it onto the
    // battlefield under your control." With no such card it is removed from the stack (603.3d).
    onEndStep: {
      when: (_g, { self, player }) => player === self.controller,
      targets: [
        {
          type: 'graveyard card',
          who: 'opponent',
          label: "target artifact or creature card in an opponent's graveyard that was put there from their library this turn",
          filter: (g, c) => (hasType(g, c, 'Artifact') || hasType(g, c, 'Creature')) && c.arrived?.from === 'library' && c.arrived.turn === g.turn,
        },
      ],
      resolve: (g, { you, targets }) => {
        const c = refGraveyard(g, targets[0]);
        if (c) enterBattlefield(g, c, { controller: you });
      },
      text: "At the beginning of your end step, choose target artifact or creature card in an opponent's graveyard that was put there from their library this turn. Put it onto the battlefield under your control.",
    },
  },
});
