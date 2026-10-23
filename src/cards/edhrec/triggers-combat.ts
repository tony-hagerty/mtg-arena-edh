// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (triggers-combat group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care.
import { registerScripts } from '../../engine/registry';
import { registerToken } from '../db';
import {
  ASSIGNS_TOUGHNESS,
  ATTACKING_HOOKS,
  ATTACKS_DESPITE_DEFENDER,
  addCounters,
  attach,
  basePT,
  battlefield,
  causedByCreatureDying,
  chooseToDiscard,
  chooseToSacrifice,
  createToken,
  dealDamage,
  delay,
  draw,
  gainLife,
  has,
  hasType,
  isCreature,
  isEquipment,
  loseLife,
  opponentsOf,
  permanent,
  pickCards,
  pump,
  putAttacking,
  refCard,
  reflexive,
  sacrifice,
  sameCard,
  simultaneously,
  stats,
  subtypesOf,
  threat,
} from '../../engine';
import type { Card, CardData, Game, TargetSpec } from '../../engine';

/** The permanent `ref` names, if it is still the same object (400.7). */
const still = (g: Game, ref: { id: string; moves: number }) => {
  const c = permanent(g, ref.id);
  return sameCard(c, ref) ? c : undefined;
};

/** A creature token the text describes (111.4), keyed like the parser keys the ones it makes. A listed token with the key wins. */
function token(key: string, d: Pick<CardData, 'name' | 'colors' | 'typeLine' | 'power' | 'toughness' | 'keywords' | 'oracleText'>): string {
  registerToken(key, { manaCost: '', cmc: 0, colorIdentity: d.colors, image: '', art: '', ...d });
  return key;
}
// "1/1 blue Thopter artifact creature tokens with flying" (Breya).
const THOPTER = token('Thopter 1/1 flying U artifact', { name: 'Thopter', colors: ['U'], typeLine: 'Token Artifact Creature — Thopter', power: '1', toughness: '1', keywords: ['Flying'], oracleText: 'Flying' });
// "1/1 green Elf Warrior creature tokens" (Lathril).
const ELF_WARRIOR = token('Elf Warrior 1/1 G', { name: 'Elf Warrior', colors: ['G'], typeLine: 'Token Creature — Elf Warrior', power: '1', toughness: '1', keywords: [], oracleText: '' });
// "1/1 red and white Soldier creature tokens with haste" (Caesar).
const SOLDIER_RW = token('Soldier 1/1 haste RW', { name: 'Soldier', colors: ['R', 'W'], typeLine: 'Token Creature — Soldier', power: '1', toughness: '1', keywords: ['Haste'], oracleText: 'Haste' });

/** Is `c` an attacking creature now? */
const attacking = (g: Game, c: Card) => !!g.combat?.attacks.some((a) => a.id === c.id);

/** "Another creature" of the source's controller's, for a sacrifice. */
const anotherCreature: TargetSpec = { type: 'creature', who: 'you', filter: (_g, c, source) => c.id !== source.id, label: 'another creature' };

registerScripts({
  'Annie Joins Up': {
    // "When Annie Joins Up enters, it deals 5 damage to target creature or planeswalker an opponent controls."
    targets: [{ type: 'creature or planeswalker', who: 'opponent', label: 'target creature or planeswalker an opponent controls' }],
    onEnter: (g, { self, targets }) => void dealDamage(g, self, targets[0], 5),
    // "If a triggered ability of a legendary creature you control triggers, that ability triggers
    // an additional time." (603.2d) Only abilities the creature has: the engine never doubles a
    // delayed or reflexive triggered ability (603.2d), since those never pass through `trigger`.
    doublesTriggers: (g, self, source) => source.zone === 'battlefield' && source.controller === self.controller && isCreature(g, source) && hasType(g, source, 'Legendary'),
  },

  'Isshin, Two Heavens as One': {
    // "If a creature attacking causes a triggered ability of a permanent you control to trigger,
    // that ability triggers an additional time." (603.2d) The events that are a creature
    // attacking are `ATTACKING_HOOKS`; a card triggering from a graveyard isn't a permanent.
    doublesTriggers: (_g, self, source, hook) => ATTACKING_HOOKS.includes(hook) && source.zone === 'battlefield' && source.controller === self.controller,
  },

  'Teysa Karlov': {
    // "If a creature dying causes a triggered ability of a permanent you control to trigger,
    // that ability triggers an additional time." (603.2d, 700.4) `causedByCreatureDying` says
    // which events are a creature dying (not "whenever you sacrifice", which triggers on what
    // caused the death). Teysa dying alongside it still counts (603.10a); each Teysa adds one more.
    doublesTriggers: (g, self, source, hook, event) => source.zone === 'battlefield' && source.controller === self.controller && causedByCreatureDying(g, source, hook, event),
    // "Creature tokens you control have vigilance and lifelink." (613.1f)
    static: (g, self, c) => (c.controller === self.controller && c.isToken && isCreature(g, c) ? { keywords: ['vigilance', 'lifelink'] } : null),
  },

  'Felothar the Steadfast': {
    // "Each creature you control assigns combat damage equal to its toughness rather than its
    // power." (510.1a) "Creatures you control can attack as though they didn't have defender."
    // Two abilities, each an effect on the creature rather than an ability of its own (113.12).
    static: (g, self, c) => (c.controller === self.controller && isCreature(g, c) ? [{ keywords: [ASSIGNS_TOUGHNESS] }, { keywords: [ATTACKS_DESPITE_DEFENDER] }] : null),
    // "{3}, {T}, Sacrifice another creature: Draw cards equal to the sacrificed creature's
    // toughness, then discard cards equal to its power." As it last was (608.2h).
    activated: {
      cost: { mana: '{3}', tap: true, sacrificeOne: anotherCreature },
      text: "{3}, {T}, Sacrifice another creature: Draw cards equal to the sacrificed creature's toughness, then discard cards equal to its power.",
      resolve: (g, { you, sacrificed }) => {
        const s = stats(g, sacrificed![0]);
        draw(g, you, s.toughness);
        chooseToDiscard(g, you, s.power);
      },
    },
  },

  'Arcades, the Strategist': {
    // Flying and vigilance are the engine's.
    // "Whenever a creature you control with defender enters, draw a card."
    onCreatureEnters: {
      when: (g, { self, entered }) => entered.controller === self.controller && has(g, permanent(g, entered.id) ?? entered, 'defender'),
      resolve: (g, { you }) => draw(g, you),
      text: 'Whenever a creature you control with defender enters, draw a card.',
    },
    // "Each creature you control with defender assigns combat damage equal to its toughness
    // rather than its power and can attack as though it didn't have defender." (510.1a) One
    // ability; whether the creature has defender is asked of the layers (613.1f).
    static: (g, self, c) => (c.controller === self.controller && isCreature(g, c) && has(g, c, 'defender') ? { keywords: [ASSIGNS_TOUGHNESS, ATTACKS_DESPITE_DEFENDER] } : null),
  },

  'Kutzil, Malamet Exemplar': {
    // "Your opponents can't cast spells during your turn." (101.2)
    forbids: (g, self, pid, act) => g.active === self.controller && pid !== self.controller && act.kind === 'cast',
    // "Whenever one or more creatures you control each with power greater than its base power
    // deals combat damage to a player, draw a card." Once for each player dealt combat damage
    // (603.2c), if one of the creatures that dealt it is yours with power above its base (613.4a-b).
    onPlayerDealtCombatDamage: {
      when: (g, { self, sources }) =>
        sources.some((s) => {
          const c = permanent(g, s.id) ?? s;
          return c.controller === self.controller && stats(g, c).power > basePT(g, c).power;
        }),
      resolve: (g, { you }) => draw(g, you),
      text: 'Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card.',
    },
  },

  'Lathril, Blade of the Elves': {
    // Menace is the engine's.
    // "Whenever Lathril deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens."
    onCombatDamageToPlayer: (g, { you, amount }) => void createToken(g, you, ELF_WARRIOR, amount),
    // "{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life."
    // Lathril is tapped for {T}, so it can't be one of the ten; a summoning-sick Elf can (302.6).
    activated: {
      cost: { tap: true, tapUntapped: { n: 10, filter: (g, c) => subtypesOf(g, c).includes('Elf'), label: 'ten untapped Elves you control' } },
      text: '{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life.',
      resolve: (g, { you }) => {
        simultaneously(g, () => opponentsOf(g, you).forEach((o) => loseLife(g, o.id, 10)));
        gainLife(g, you, 10);
      },
    },
  },

  'Cloud, Ex-SOLDIER': {
    // Haste is the engine's.
    // "When Cloud enters, attach up to one target Equipment you control to it."
    targets: [{ type: 'permanent', who: 'you', optional: true, filter: (g, c) => isEquipment(g, c), label: 'up to one target Equipment you control' }],
    onEnter: (g, { self, targets }) => attach(g, refCard(g, targets[0]), permanent(g, self.id)),
    // "Whenever Cloud attacks, draw a card for each equipped attacking creature you control. Then
    // if Cloud has power 7 or greater, create two Treasure tokens." Cloud's power as this
    // resolves, or as it last was if it has left (608.2h).
    onAttack: (g, { self, you }) => {
      const equipped = g.players[you].battlefield.filter((c) => isCreature(g, c) && attacking(g, c) && battlefield(g).some((e) => e.attachedTo === c.id && isEquipment(g, e)));
      draw(g, you, equipped.length);
      if (stats(g, self).power >= 7) createToken(g, you, 'Treasure', 2);
    },
  },

  "Caesar, Legion's Emperor": {
    // "Whenever you attack, you may sacrifice another creature. When you do, choose two —"
    // "Whenever you attack" triggers once as attackers are declared (508.1m). The sacrifice is
    // chosen as the ability resolves (608.2d); "when you do" is a reflexive trigger (603.12).
    onAttackersDeclared: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { self, you }) => {
        const options = g.players[you].battlefield.filter((c) => c.id !== self.id && isCreature(g, c));
        if (options.length) pickCards(g, you, options, { min: 0, max: 1, text: 'sacrifice another creature, or none', button: 'Sacrifice', then: 'caesar', data: { bot: 'sacrifice' } });
      },
      text: 'Whenever you attack, you may sacrifice another creature. When you do, choose two —',
    },
    then: {
      caesar: (g, { self, you, picked }) => {
        const c = picked[0] && permanent(g, picked[0].id);
        if (!c) return;
        sacrifice(g, c);
        // Sacrificed, even if a replacement effect sent it somewhere other than the graveyard (701.21a).
        if (c.zone !== 'battlefield') reflexive(g, self, you, 'chooseTwo');
      },
    },
    // Bots sacrifice their least threatening creature token: two tapped and attacking Soldiers
    // and a card come back for it. They keep nontoken creatures.
    botChoice: {
      caesar: (g, _pid, choice) => {
        const cards = (choice as { cards: string[] }).cards.map((id) => permanent(g, id)).filter((c): c is Card => !!c && c.isToken);
        const worst = [...cards].sort((a, b) => threat(g, a) - threat(g, b))[0];
        return { type: 'chooseCards', cards: worst ? [worst.id] : [] };
      },
    },
    reflexive: {
      chooseTwo: {
        text: 'Choose two —',
        resolve: () => {},
        // The modes are chosen as the reflexive ability goes on the stack (603.3c, 700.2b).
        modes: {
          min: 2,
          max: 2,
          modes: [
            {
              // "Create two 1/1 red and white Soldier creature tokens with haste that are tapped and
              // attacking." Whom they attack is their controller's choice (508.4).
              text: 'Create two 1/1 red and white Soldier creature tokens with haste that are tapped and attacking.',
              resolve: (g, { you }) => putAttacking(g, you, createToken(g, you, SOLDIER_RW, 2, { tapped: true })),
            },
            {
              // "You draw a card and you lose 1 life."
              text: 'You draw a card and you lose 1 life.',
              resolve: (g, { you }) => {
                draw(g, you);
                loseLife(g, you, 1);
              },
            },
            {
              // "Caesar deals damage equal to the number of creature tokens you control to target opponent."
              text: 'Caesar deals damage equal to the number of creature tokens you control to target opponent.',
              targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
              resolve: (g, { self, you, targets }) => void dealDamage(g, self, targets[0], g.players[you].battlefield.filter((c) => c.isToken && isCreature(g, c)).length),
            },
          ],
          // Bots take the tokens and the damage (the damage counts the new tokens, 608.2c).
          bot: () => [0, 2],
        },
      },
    },
  },

  'Breya, Etherium Shaper': {
    // "When Breya enters, create two 1/1 blue Thopter artifact creature tokens with flying."
    onEnter: (g, { you }) => void createToken(g, you, THOPTER, 2),
    // "{2}, Sacrifice two artifacts: Choose one —" Breya herself is an artifact that can be
    // sacrificed. The mode is chosen as it is activated (700.2a).
    activated: {
      cost: { mana: '{2}', sacrificeOne: { type: 'permanent', who: 'you', filter: (g, c) => hasType(g, c, 'Artifact'), label: 'an artifact' }, sacrificeCount: 2 },
      text: '{2}, Sacrifice two artifacts: Choose one —',
      modes: {
        min: 1,
        max: 1,
        modes: [
          {
            // "Breya deals 3 damage to target player or planeswalker."
            text: 'Breya deals 3 damage to target player or planeswalker.',
            targets: [{ type: 'player or planeswalker', label: 'target player or planeswalker' }],
            resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 3),
          },
          {
            // "Target creature gets -4/-4 until end of turn." (611.2c)
            text: 'Target creature gets -4/-4 until end of turn.',
            targets: [{ type: 'creature', label: 'target creature' }],
            resolve: (g, { targets }) => pump(g, refCard(g, targets[0]), -4, -4),
          },
          {
            // "You gain 5 life."
            text: 'You gain 5 life.',
            resolve: (g, { you }) => gainLife(g, you, 5),
          },
        ],
      },
      // The chosen mode resolves instead (700.2).
      resolve: () => {},
    },
  },

  'Zurgo Stormrender': {
    // "Mobilize 1" (702.181a): "Whenever this creature attacks, create one 1/1 red Warrior
    // creature token. That token enters tapped and attacking. Sacrifice it at the beginning of
    // the next end step." Whom it attacks is its controller's choice (508.4).
    onAttack: {
      resolve: (g, { self, you }) => {
        const tokens = createToken(g, you, 'Warrior', 1, { tapped: true });
        putAttacking(g, you, tokens);
        if (tokens.length) delay(g, self, you, { key: 'mobilize', step: 'end', data: { ids: tokens.map((t) => t.id) } });
      },
      text: 'Mobilize 1',
    },
    delayed: {
      mobilize: (g, { data }) => {
        for (const id of data.ids as string[]) {
          const t = permanent(g, id);
          if (t) sacrifice(g, t);
        }
      },
    },
    // "Whenever a creature token you control leaves the battlefield, draw a card if it was
    // attacking. Otherwise, each opponent loses 1 life." The token as it last was (603.10a);
    // whether it was attacking is remembered with the event.
    onPermanentLeaves: {
      when: (g, { self, left }) => left.isToken && left.controller === self.controller && isCreature(g, left),
      resolve: (g, { you, attacking: wasAttacking }) => {
        if (wasAttacking) draw(g, you);
        else simultaneously(g, () => opponentsOf(g, you).forEach((o) => loseLife(g, o.id, 1)));
      },
      text: 'Whenever a creature token you control leaves the battlefield, draw a card if it was attacking. Otherwise, each opponent loses 1 life.',
    },
  },

  'Korvold, Fae-Cursed King': {
    // Flying is the engine's.
    // "Whenever Korvold enters or attacks, sacrifice another permanent." The permanent is chosen
    // as the ability resolves (701.21a), not targeted.
    onEnter: (g, { self, you }) => chooseToSacrifice(g, you, { type: 'permanent', who: 'you', filter: (_g, c, source) => c.id !== source.id, label: 'another permanent' }, self),
    onAttack: (g, { self, you }) => chooseToSacrifice(g, you, { type: 'permanent', who: 'you', filter: (_g, c, source) => c.id !== source.id, label: 'another permanent' }, self),
    // "Whenever you sacrifice a permanent, put a +1/+1 counter on Korvold and draw a card." The
    // counter goes on Korvold only if it is still the same object (400.7); the card is drawn either way.
    onSacrifice: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { self, you }) => {
        addCounters(g, still(g, self), 1);
        draw(g, you);
      },
      text: 'Whenever you sacrifice a permanent, put a +1/+1 counter on Korvold and draw a card.',
    },
  },
});
