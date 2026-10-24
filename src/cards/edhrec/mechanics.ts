// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (mechanics group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care.
// Imported from the engine's own modules, not its index: this file loads while the index is
// still loading, and `firebending(2)`, `station()` and `crew(8)` are called as it loads.
import { registerScripts } from '../../engine/registry';
import { canSayYes } from '../../engine/engine';
import {
  addCounters,
  ask,
  becomeMonarch,
  copyItem,
  counterCount,
  createToken,
  createTokens,
  crew,
  damagePlayer,
  discard,
  draw,
  earthbend,
  extraLand,
  firebending,
  gainLife,
  goad,
  grantOf,
  hasType,
  isAura,
  isEquipment,
  isLand,
  loseLife,
  manaValue,
  opponentsOf,
  permanent,
  pickCards,
  refCard,
  resolvingItem,
  rollDice,
  simultaneously,
  station,
  subtypesOf,
  transform,
} from '../../engine/rules';
import type { AskChoice, Bend, Card, Game, GrantedTrigger, PlayerId, Trigger, TriggerEvents, TriggerHook } from '../../engine/types';

const granted = <H extends TriggerHook>(hook: H, trigger: Trigger<TriggerEvents[H]>): GrantedTrigger => ({ hook, trigger: trigger as Trigger<never> });

/** Is an opponent of `you` the monarch now (725.1)? */
const opponentIsMonarch = (g: Game, you: PlayerId) => g.monarch !== undefined && g.monarch !== null && g.monarch !== you && !g.players[g.monarch].lost;

/**
 * The source of the resolving ability, if it is still the same object it was when the ability
 * triggered (400.7); the ability then acts on it. Its snapshot from then is `since` for 701.27f.
 */
function stillHere(g: Game): { now: Card; since: Card } | null {
  const item = resolvingItem(g);
  const now = item && permanent(g, item.card.id);
  return item && now && now.moves === item.card.moves ? { now, since: item.card } : null;
}

const BENDS: Bend[] = ['waterbend', 'earthbend', 'firebend', 'airbend'];

/** The script name of Hearthhull's "2+ |" ability, which a static ability gives it while it has the counters (721.2a). */
const HEARTHHULL_2 = 'Hearthhull, the Worldseed (2+)';

registerScripts({
  'Toph, the First Metalbender': {
    // "Nontoken artifacts you control are lands in addition to their other types." A type-changing
    // effect in layer 4 (613.1d, 205.1b); the reminder text says they don't gain the ability to
    // tap for mana, and nothing here gives them one. It applies only on the battlefield (a card
    // in hand isn't a land card to play, as the card's rulings say).
    static: (g, self, c) => (c.controller === self.controller && !c.isToken && hasType(g, c, 'Artifact') ? { types: ['Land'] } : null),
    // "At the beginning of your end step, earthbend 2." (701.66a: "Target land you control ...")
    onEndStep: {
      when: (_g, { self, player }) => player === self.controller,
      targets: [{ type: 'permanent', who: 'you', filter: (g, c) => isLand(g, c), label: 'land you control' }],
      text: 'At the beginning of your end step, earthbend 2.',
      resolve: (g, { you, targets }) => earthbend(g, refCard(g, targets[0]), 2, you),
    },
  },

  'Avatar Aang': {
    // "Flying, firebending 2" (702.189a).
    onAttack: firebending(2),
    // "Whenever you waterbend, earthbend, firebend, or airbend, draw a card. Then if you've done
    // all four this turn, transform Avatar Aang." The four are counted over the whole turn
    // (`Player.bent`), and he transforms only if he hasn't transformed since the ability was put
    // on the stack (701.27f).
    onBend: {
      when: (_g, { self, player }) => player === self.controller,
      text: "Whenever you waterbend, earthbend, firebend, or airbend, draw a card. Then if you've done all four this turn, transform Avatar Aang.",
      resolve: (g, { you }) => {
        draw(g, you, 1);
        const bent = new Set(g.players[you].bent ?? []);
        const here = stillHere(g);
        if (here && BENDS.every((k) => bent.has(k))) transform(g, here.now, here.since);
      },
    },
  },

  'Aang, Master of Elements': {
    // "Spells you cast cost {W}{U}{B}{R}{G} less to cast. (This can reduce generic costs.)"
    // Each symbol takes one mana of its colour off, a hybrid half chosen to pay for as many as
    // possible (118.7e, as Morophon's rulings say), or one generic mana if the cost has none (118.7b-c).
    reducesColoredCost: (_g, self, _spell, caster) => (caster === self.controller ? { colors: ['W', 'U', 'B', 'R', 'G'] } : null),
    // "At the beginning of each upkeep, you may transform Aang, Master of Elements. If you do,
    // you gain 4 life, draw four cards, put four +1/+1 counters on him, and he deals 4 damage to
    // each opponent." "You may" is the controller's choice as it resolves (608.2d).
    onUpkeep: {
      text: 'At the beginning of each upkeep, you may transform Aang, Master of Elements. If you do, you gain 4 life, draw four cards, put four +1/+1 counters on him, and he deals 4 damage to each opponent.',
      resolve: (g, { you }) => {
        if (!stillHere(g)) return;
        ask(g, you, { text: 'Transform Aang, Master of Elements? If you do, you gain 4 life, draw four cards, put four +1/+1 counters on him, and he deals 4 damage to each opponent.', yes: 'Transform', no: "Don't", then: 'transform' });
      },
    },
    then: {
      transform: (g, { yes, you }) => {
        const here = stillHere(g);
        if (!yes || !here) return;
        const face = here.now.face;
        transform(g, here.now, here.since); // only if he hasn't transformed since (701.27f)
        if (here.now.face === face) return; // "If you do": he didn't transform, so nothing more happens
        gainLife(g, you, 4);
        draw(g, you, 4);
        addCounters(g, here.now, 4);
        // "He deals 4 damage to each opponent": one event (603.2c).
        simultaneously(g, () => {
          for (const o of opponentsOf(g, you)) damagePlayer(g, here.now, o.id, 4);
        });
      },
    },
    botChoice: { transform: () => ({ type: 'answer', yes: true }) },
  },

  'Fire Lord Azula': {
    // "Firebending 2" (702.189a).
    onAttack: firebending(2),
    // "Whenever you cast a spell while Fire Lord Azula is attacking, copy that spell. You may
    // choose new targets for the copy." An attacking creature is one declared as an attacker
    // that is still in combat (506.4). The copy is made even if the spell has left the stack by
    // then (as the card's rulings say), from the spell as it was cast (707.10).
    onCast: {
      when: (g, { self, caster }) => caster === self.controller && !!g.combat?.attacks.some((a) => a.id === self.id),
      text: 'Whenever you cast a spell while Fire Lord Azula is attacking, copy that spell. You may choose new targets for the copy.',
      resolve: (g, { you, item }) => copyItem(g, g.stack.find((x) => x.id === item.id) ?? item, you),
    },
  },

  'Shorikai, Genesis Engine': {
    activated: [
      {
        // "{1}, {T}: Draw two cards, then discard a card. Create a 1/1 colorless Pilot creature token
        // with 'This token crews Vehicles as though its power were 2 greater.'" The token comes after
        // the discard (608.2c).
        cost: { mana: '{1}', tap: true },
        text: 'Draw two cards, then discard a card. Create a 1/1 colorless Pilot creature token.',
        resolve: (g, { you }) => {
          draw(g, you, 2);
          const hand = g.players[you].hand;
          if (!hand.length) return void createToken(g, you, 'Pilot');
          pickCards(g, you, hand, { min: 1, max: 1, text: 'discard a card', button: 'Discard', then: 'loot', data: { bot: 'discard' } });
        },
      },
      // "Crew 8" (702.122a).
      crew(8),
    ],
    then: {
      loot: (g, { you, picked }) => {
        for (const c of picked) discard(g, c);
        createToken(g, you, 'Pilot');
      },
    },
    botActivate: (g, pid, _self, activated) => activated === 0 && g.active === pid && g.step === 'main2' && !g.stack.length,
  },
  Pilot: {
    // "This token crews Vehicles as though its power were 2 greater." (702.122a)
    crewBonus: () => 2,
  },

  // "2+ | {1}, {T}, Sacrifice a land: Draw two cards. You may play an additional land this turn."
  // The ability Hearthhull has while it has two or more charge counters (721.2a), registered on
  // its own so a static ability can give it (`LayerParts.activatedOf`, layer 6).
  [HEARTHHULL_2]: {
    activated: {
      cost: { mana: '{1}', tap: true, sacrificeOne: { type: 'permanent', who: 'you', filter: (g, c) => isLand(g, c), label: 'a land' } },
      text: '2+ | {1}, {T}, Sacrifice a land: Draw two cards. You may play an additional land this turn.',
      resolve: (g, { you }) => {
        draw(g, you, 2);
        extraLand(g, you); // cumulative with other such effects (305.2b)
      },
    },
  },
  'Hearthhull, the Worldseed': {
    // "Station" (702.184a). The 2+ ability comes from the static ability below while it has the counters.
    activated: station(),
    static: (_g, self, c) =>
      c.id !== self.id
        ? null
        : [
            // "2+ | [ability]": "As long as this permanent has 2 or more charge counters on it, it has [ability]." (721.2a)
            counterCount(self, 'charge') >= 2 ? { activatedOf: [HEARTHHULL_2] } : null,
            // "8+ | Flying, vigilance, haste" with its power/toughness box 6/7: "As long as this permanent
            // has 8 or more charge counters on it, it has [abilities] and is a creature with base power
            // and toughness 6/7 in addition to its other types." (721.2b)
            counterCount(self, 'charge') >= 8 ? { types: ['Creature'], setPower: 6, setToughness: 7, keywords: ['flying', 'vigilance', 'haste'] } : null,
          ],
    // "Whenever you sacrifice a land, each opponent loses 2 life." One event for all of them (603.2c).
    onSacrifice: {
      when: (g, { self, card, player }) => player === self.controller && isLand(g, card),
      text: 'Whenever you sacrifice a land, each opponent loses 2 life.',
      resolve: (g, { you }) =>
        simultaneously(g, () => {
          for (const o of opponentsOf(g, you)) loseLife(g, o.id, 2);
        }),
    },
    // Bots station after combat (the tapped creature has attacked already) until it is a creature,
    // and sacrifice a land for cards once they have lands to spare.
    botActivate: (g, pid, self, activated) =>
      g.active === pid && g.step === 'main2' && !g.stack.length && (activated === 0 ? counterCount(self, 'charge') < 8 : g.players[pid].battlefield.filter((c) => isLand(g, c)).length >= 5),
  },

  'Bello, Bard of the Brambles': {
    // "During your turn, each non-Equipment artifact and non-Aura enchantment you control with
    // mana value 4 or greater is a 4/4 Elemental creature in addition to its other types and has
    // indestructible, haste, and 'Whenever this creature deals combat damage to a player, draw a
    // card.'" Types in layer 4 (613.1d; Elemental goes with the creature type it gains, 205.3d),
    // the abilities in layer 6 (613.1f), base power and toughness in layer 7b (613.4b). The set
    // of objects is fixed as the effect starts to apply (613.6).
    static: (g, self, c) =>
      g.active === self.controller &&
      c.controller === self.controller &&
      ((hasType(g, c, 'Artifact') && !isEquipment(g, c)) || (hasType(g, c, 'Enchantment') && !isAura(g, c))) &&
      manaValue(c) >= 4
        ? { types: ['Creature'], subtypes: ['Elemental'], setPower: 4, setToughness: 4, keywords: ['indestructible', 'haste'], ...grantOf(self) }
        : null,
    grants: [
      granted('onCombatDamageToPlayer', {
        text: 'Whenever this creature deals combat damage to a player, draw a card.',
        resolve: (g, { you }) => draw(g, you, 1),
      }),
    ],
  },

  'Alela, Cunning Conqueror': {
    // "Whenever you cast your first spell during each opponent's turn, create a 1/1 black Faerie
    // Rogue creature token with flying." Spells cast this turn are counted before the trigger
    // is offered, so the first is the one that makes the count 1.
    onCast: {
      when: (g, { self, caster }) => caster === self.controller && g.active !== self.controller && g.players[caster].spellsCast === 1,
      text: "Whenever you cast your first spell during each opponent's turn, create a 1/1 black Faerie Rogue creature token with flying.",
      resolve: (g, { you }) => void createToken(g, you, 'Faerie Rogue 1/1 flying'),
    },
    // "Whenever one or more Faeries you control deal combat damage to a player, goad target
    // creature that player controls." Once for each player dealt combat damage (603.2c, and the
    // card's rulings); the Faeries are looked at as the damage is dealt.
    onPlayerDealtCombatDamage: {
      when: (g, { self, sources }) => sources.some((s) => s.controller === self.controller && subtypesOf(g, permanent(g, s.id) ?? s).includes('Faerie')),
      targets: [{ type: 'creature', who: 'any', filter: (_g, c, source) => c.controller === (source.triggeredBy as { player?: PlayerId } | undefined)?.player, label: 'creature that player controls' }],
      text: 'Whenever one or more Faeries you control deal combat damage to a player, goad target creature that player controls.',
      resolve: (g, { you, targets }) => goad(g, refCard(g, targets[0]), you),
    },
  },

  'Queen Marchesa': {
    // "When Queen Marchesa enters, you become the monarch." (725.1)
    onEnter: (g, { you }) => becomeMonarch(g, you),
    // "At the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin
    // creature token with deathtouch and haste." An intervening "if" (603.4): checked as it
    // would trigger and again as it resolves.
    onUpkeep: {
      when: (g, { self, player }) => player === self.controller && opponentIsMonarch(g, self.controller),
      text: 'At the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin creature token with deathtouch and haste.',
      resolve: (g, { you }) => {
        if (opponentIsMonarch(g, you)) createToken(g, you, 'Assassin 1/1 deathtouch haste');
      },
    },
  },

  'Mr. House, President and CEO': {
    // "Whenever you roll a 4 or higher, create a 3/3 colorless Robot artifact creature token. If
    // you rolled 6 or higher, instead create that token and a Treasure token." One trigger for
    // each die (603.2c); the roll it triggered on decides which tokens, created together.
    onRoll: {
      when: (_g, { self, player, result }) => player === self.controller && result >= 4,
      text: 'Whenever you roll a 4 or higher, create a 3/3 colorless Robot artifact creature token. If you rolled 6 or higher, instead create that token and a Treasure token.',
      resolve: (g, { you, result }) => void createTokens(g, you, [{ key: 'Robot 3/3', count: 1 }, ...(result >= 6 ? [{ key: 'Treasure', count: 1 }] : [])]),
    },
    activated: {
      // "{4}, {T}: Roll a six-sided die plus an additional six-sided die for each mana from Treasures
      // spent to activate this ability." The mana spent is remembered by its source (`ctx.spentFrom`).
      cost: { mana: '{4}', tap: true },
      text: 'Roll a six-sided die plus an additional six-sided die for each mana from Treasures spent to activate this ability.',
      resolve: (g, { you, spentFrom }) => void rollDice(g, you, 6, 1 + (spentFrom ?? []).filter((m) => m.name === 'Treasure').length),
    },
    // The look-ahead can't value a roll: bots roll after combat, with the mana to spare.
    botActivate: (g, pid) => g.active === pid && g.step === 'main2' && !g.stack.length,
  },

  'Ulalek, Fused Atrocity': {
    // "Whenever you cast an Eldrazi spell, you may pay {C}{C}. If you do, copy all spells you
    // control, then copy all other activated and triggered abilities you control. You may choose
    // new targets for the copies. (Mana abilities can't be copied.)" A changeling spell is an
    // Eldrazi spell (702.73a). "All other" leaves out this ability itself.
    onCast: {
      when: (g, { self, caster, card }) => caster === self.controller && subtypesOf(g, card).includes('Eldrazi'),
      text: 'Whenever you cast an Eldrazi spell, you may pay {C}{C}. If you do, copy all spells you control, then copy all other activated and triggered abilities you control.',
      resolve: (g, { you }) => ask(g, you, { text: 'Pay {C}{C} to copy all spells you control, then all other activated and triggered abilities you control?', cost: '{C}{C}', yes: 'Pay {C}{C}', no: "Don't Pay", then: 'copies' }),
    },
    then: {
      copies: (g, { yes, you }) => {
        if (!yes) return;
        const own = g.resolving;
        for (const s of g.stack.filter((x) => x.kind === 'spell' && x.controller === you)) copyItem(g, s, you);
        for (const a of g.stack.filter((x) => x.kind !== 'spell' && x.controller === you && x.id !== own)) copyItem(g, a, you);
      },
    },
    botChoice: { copies: (g, _pid, choice) => ({ type: 'answer', yes: canSayYes(g, choice as AskChoice) }) },
  },
});
