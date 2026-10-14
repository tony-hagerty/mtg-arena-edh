// Card behaviour for the two-colour starter decks (session 8): white-black, black-red,
// red-green and green-white. Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care. Cards the decks share
// with the older mono-coloured decks keep their scripts in scripts.ts.
import { registerScripts } from '../engine/registry';
import {
  STARTING_LIFE,
  abilitySource,
  addCounters,
  addMana,
  allCreatures,
  ask,
  battlefield,
  attachedBonus,
  chooseToDiscard,
  chooseToSacrifice,
  copyToken,
  createToken,
  creaturesOf,
  damageCard,
  dealDamage,
  destroy,
  destroyMany,
  draw,
  exile,
  finishEnter,
  gainControl,
  gainLife,
  has,
  hasType,
  isCreature,
  isLand,
  isPlaneswalker,
  log,
  loseLife,
  moveCard,
  opponentsOf,
  permanent,
  populate,
  pump,
  refCard,
  refCards,
  refGraveyard,
  refPlayer,
  sameCard,
  stats,
  subtypesOf,
  turnOrder,
} from '../engine/rules';
import type { Card, CardScript, Game, PlayerId, TargetSpec } from '../engine/types';

// ---------- target specs ----------

const anyTarget: TargetSpec = { type: 'any', label: 'any target' };
const targetPlayer: TargetSpec = { type: 'player', label: 'target player' };
const targetOpponent: TargetSpec = { type: 'player', who: 'opponent', label: 'target opponent' };
const nonland = (label: string): TargetSpec => ({ type: 'permanent', label, filter: (_g, c) => !isLand(c) });
const typed = (label: string, types: string[]): TargetSpec => ({ type: 'permanent', label, filter: (_g, c) => types.some((t) => hasType(c, t)) });
const yourCreature: TargetSpec = { type: 'creature', who: 'you', label: 'a creature to sacrifice' };

// ---------- reusable pieces ----------

/** Ferocious: "if you control a creature with power 4 or greater" (an ability word, 207.2c). */
const ferocious = (g: Game, you: PlayerId) => creaturesOf(g, you).some((c) => stats(g, c).power >= 4);

/** "Whenever a Dragon you control attacks". */
const dragonOfYoursAttacks = (_g: Game, e: { self: Card; attacker: Card }) => e.attacker.controller === e.self.controller && hasType(e.attacker, 'Dragon');

/** Has the creature type Dragon (205.3m), not just "Dragon" somewhere in its type line. */
const isDragon = (c: Card) => subtypesOf(c).includes('Dragon');

/** The permanent an event remembered, if it is still the same object (400.7). */
const sameObject = (g: Game, remembered: Card) => {
  const c = permanent(g, remembered.id);
  return sameCard(c, remembered) ? c : undefined;
};

const nonHumans = (g: Game, you: PlayerId) => creaturesOf(g, you).filter((c) => !hasType(c, 'Human'));

const sixLands = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter(isLand).length >= 6;

/** "Creatures you control gain indestructible until end of turn": those you control now (611.2c). */
const indestructibleTeam = (g: Game, you: PlayerId) => {
  for (const c of creaturesOf(g, you)) pump(g, c, 0, 0, ['indestructible']);
};

/** "Whenever you gain life": the trigger condition, from the permanent's side. */
const youGainLife = (_g: Game, e: { self: Card; player: PlayerId }) => e.player === e.self.controller;

/** "Each opponent loses N life": returns the total actually lost. */
const eachOpponentLoses = (g: Game, you: PlayerId, n: number) => opponentsOf(g, you).reduce((total, o) => total + loseLife(g, o.id, n), 0);

/** The opponents of `you` in APNAP order (101.4), for "each opponent" choices. */
const opponentsInOrder = (g: Game, you: PlayerId) => turnOrder(g, g.active).filter((pid) => pid !== you);

/** A land that "enters tapped" and "When this land enters, you gain 1 life", tapping for either colour. */
const gainLand = (colors: ('W' | 'U' | 'B' | 'R' | 'G')[]): CardScript => ({
  entersTapped: true,
  onEnter: (g, { you }) => gainLife(g, you, 1),
  mana: { amount: 1, colors },
});

/** "{T}: Add {C}. {T}: Add {A} or {B}. This land deals 1 damage to you." */
const painLand = (colors: ('W' | 'U' | 'B' | 'R' | 'G')[]): CardScript => ({
  mana: [
    { amount: 1, colors: ['C'] },
    { amount: 1, colors, damage: 1 },
  ],
});

/** "This land enters tapped unless you control a [A] or a [B]." Checked as it enters (614.1c). */
const checkLand = (colors: ('W' | 'U' | 'B' | 'R' | 'G')[], types: string[]): CardScript => ({
  entersTapped: (g, _c, controller) => !g.players[controller].battlefield.some((x) => types.some((t) => hasType(x, t))),
  mana: { amount: 1, colors },
});

/**
 * "As this land enters, you may pay 2 life. If you don't, it enters tapped." A replacement
 * effect with a choice (614.12a). Its mana comes from its basic land types (305.6).
 */
const shockLand: CardScript = {
  replaceEnter: (g, c, controller) => {
    ask(g, controller, { text: `Pay 2 life, or ${c.name} enters tapped.`, life: 2, yes: 'Pay 2 Life', no: 'Enter Tapped', then: 'shock', script: c.id });
    return true;
  },
  then: { shock: (g, { self, yes, data }) => finishEnter(g, self, data, { tapped: !yes }) },
  // A bot pays on its own turn while it has life to spare.
  botChoice: { shock: (g, pid) => ({ type: 'answer', yes: g.active === pid && g.players[pid].life > 15 }) },
};

registerScripts({
  // ===== Commanders =====
  'Karlov of the Ghost Council': {
    // "Whenever you gain life, put two +1/+1 counters on Karlov."
    onLifeGain: { when: youGainLife, resolve: (g) => addCounters(g, abilitySource(g), 2) },
    // "{W}{B}, Remove six +1/+1 counters from Karlov: Exile target creature."
    activated: {
      cost: { mana: '{W}{B}', counters: { kind: '+1/+1', n: 6 } },
      targets: [{ type: 'creature', label: 'target creature' }],
      text: '{W}{B}, remove six +1/+1 counters: exile target creature',
      resolve: (g, { targets }) => exile(g, refCard(g, targets[0])),
    },
  },
  'Judith, the Scourge Diva': {
    // "Other creatures you control get +1/+0."
    static: (_g, self, c) => (c.id !== self.id && c.controller === self.controller ? { power: 1 } : null),
    // "Whenever a nontoken creature you control dies, Judith deals 1 damage to any target." Judith's own death counts (603.10a).
    onCreatureDies: {
      when: (_g, { self, dead }) => dead.controller === self.controller && !dead.isToken,
      targets: [anyTarget],
      resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 1),
    },
  },

  // ===== White-black =====
  'Vito, Thorn of the Dusk Rose': {
    // "Whenever you gain life, target opponent loses that much life."
    onLifeGain: {
      when: youGainLife,
      targets: [targetOpponent],
      resolve: (g, { targets, amount }) => {
        const o = refPlayer(g, targets[0]);
        if (o) loseLife(g, o.id, amount);
      },
    },
    // "{3}{B}{B}: Creatures you control gain lifelink until end of turn." Those it controls as it resolves (611.2c).
    activated: {
      cost: { mana: '{3}{B}{B}' },
      text: '{3}{B}{B}: creatures you control gain lifelink until end of turn',
      resolve: (g, { you }) => {
        for (const c of creaturesOf(g, you)) pump(g, c, 0, 0, ['lifelink']);
      },
    },
  },
  'Cliffhaven Vampire': {
    // "Whenever you gain life, each opponent loses 1 life."
    onLifeGain: { when: youGainLife, resolve: (g, { you }) => void eachOpponentLoses(g, you, 1) },
  },
  'Blood Artist': {
    // "Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life."
    onCreatureDies: {
      when: () => true,
      targets: [targetPlayer],
      resolve: (g, { you, targets }) => {
        const p = refPlayer(g, targets[0]);
        if (!p) return;
        loseLife(g, p.id, 1);
        gainLife(g, you, 1);
      },
    },
  },
  'Cruel Celebrant': {
    // "Whenever this creature or another creature or planeswalker you control dies, each opponent loses 1 life and you gain 1 life."
    onCreatureDies: {
      when: (_g, { self, dead }) => dead.controller === self.controller,
      resolve: (g, { you }) => {
        eachOpponentLoses(g, you, 1);
        gainLife(g, you, 1);
      },
    },
    onPlaneswalkerDies: {
      when: (_g, { self, dead }) => dead.controller === self.controller,
      resolve: (g, { you }) => {
        eachOpponentLoses(g, you, 1);
        gainLife(g, you, 1);
      },
    },
  },
  'Righteous Valkyrie': {
    // "Whenever another Angel or Cleric you control enters, you gain life equal to that creature's toughness."
    onCreatureEnters: {
      when: (_g, { self, entered }) => entered.id !== self.id && entered.controller === self.controller && (hasType(entered, 'Angel') || hasType(entered, 'Cleric')),
      // Its toughness now, or as it last was if it has left (608.2h).
      resolve: (g, { you, entered }) => gainLife(g, you, Math.max(0, stats(g, permanent(g, entered.id) ?? entered).toughness)),
    },
    // "As long as you have at least 7 life more than your starting life total, creatures you control get +2/+2."
    static: (g, self, c) => (c.controller === self.controller && g.players[self.controller].life >= STARTING_LIFE + 7 ? { power: 2, toughness: 2 } : null),
  },
  'Ministrant of Obligation': {
    // "Afterlife 2" (702.135a): "When this creature dies, create two 1/1 white and black Spirit creature tokens with flying."
    onDies: (g, { you }) => void createToken(g, you, 'Spirit 1/1 flying WB', 2),
  },
  'Butcher of Malakir': {
    // "Whenever this creature or another creature you control dies, each opponent sacrifices a creature of their choice."
    onCreatureDies: {
      when: (_g, { self, dead }) => dead.controller === self.controller,
      resolve: (g, { self, you }) => {
        for (const o of opponentsInOrder(g, you)) chooseToSacrifice(g, o, { type: 'creature', label: 'a creature' }, self);
      },
    },
  },
  Mortify: {
    targets: [typed('target creature or enchantment', ['Creature', 'Enchantment'])],
    onResolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  'Anguished Unmaking': {
    // "Exile target nonland permanent. You lose 3 life."
    targets: [nonland('target nonland permanent')],
    onResolve: (g, { you, targets }) => {
      exile(g, refCard(g, targets[0]));
      loseLife(g, you, 3);
    },
  },
  Vindicate: {
    targets: [{ type: 'permanent', label: 'target permanent' }],
    onResolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  'Utter End': {
    targets: [nonland('target nonland permanent')],
    onResolve: (g, { targets }) => exile(g, refCard(g, targets[0])),
  },
  'Lingering Souls': {
    // "Create two 1/1 white Spirit creature tokens with flying." "Flashback {1}{B}"
    onResolve: (g, { you }) => void createToken(g, you, 'Spirit 1/1 flying', 2),
    flashback: '{1}{B}',
  },
  'Zealous Persecution': {
    // "Until end of turn, creatures you control get +1/+1 and creatures your opponents control get -1/-1."
    onResolve: (g, { you }) => {
      for (const p of g.players) {
        if (p.lost) continue;
        for (const c of creaturesOf(g, p.id)) pump(g, c, p.id === you ? 1 : -1, p.id === you ? 1 : -1);
      }
    },
  },
  'Debt to the Deathless': {
    // "Each opponent loses two times X life. You gain life equal to the life lost this way."
    onResolve: (g, { self, you }) => gainLife(g, you, eachOpponentLoses(g, you, 2 * (self.cast?.x ?? 0))),
  },

  // ===== Black-red =====
  'Mayhem Devil': {
    // "Whenever a player sacrifices a permanent, this creature deals 1 damage to any target."
    onSacrifice: { when: () => true, targets: [anyTarget], resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 1) },
  },
  'Falkenrath Aristocrat': {
    // "Sacrifice a creature: This creature gains indestructible until end of turn. If the
    // sacrificed creature was a Human, put a +1/+1 counter on this creature."
    activated: {
      cost: { sacrificeOne: yourCreature },
      text: 'Sacrifice a creature: indestructible until end of turn (+1/+1 counter if it was a Human)',
      resolve: (g, { sacrificed }) => {
        const self = abilitySource(g);
        pump(g, self, 0, 0, ['indestructible']);
        if (sacrificed?.[0] && hasType(sacrificed[0], 'Human')) addCounters(g, self, 1);
      },
    },
  },
  'Bloodthrone Vampire': {
    // "Sacrifice a creature: This creature gets +2/+2 until end of turn."
    activated: {
      cost: { sacrificeOne: yourCreature },
      text: 'Sacrifice a creature: +2/+2 until end of turn',
      resolve: (g) => pump(g, abilitySource(g), 2, 2),
    },
  },
  'Goblin Bombardment': {
    // "Sacrifice a creature: This enchantment deals 1 damage to any target."
    activated: {
      cost: { sacrificeOne: yourCreature },
      targets: [anyTarget],
      text: 'Sacrifice a creature: 1 damage to any target',
      resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 1),
    },
  },
  'Carrier Thrall': {
    // "When this creature dies, create a 1/1 colorless Eldrazi Scion creature token. It has 'Sacrifice this token: Add {C}.'"
    onDies: (g, { you }) => void createToken(g, you, 'Eldrazi Scion'),
  },
  'Eldrazi Scion': {
    // "Sacrifice this token: Add {C}." No {T}: a summoning-sick Scion can use it.
    mana: { amount: 1, colors: ['C'], noTap: true, sacrifice: true },
  },
  Terminate: {
    // "Destroy target creature. It can't be regenerated." Nothing in the game regenerates.
    targets: [{ type: 'creature', label: 'target creature' }],
    onResolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  Bedevil: {
    targets: [typed('target artifact, creature, or planeswalker', ['Artifact', 'Creature', 'Planeswalker'])],
    onResolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  Dreadbore: {
    targets: [{ type: 'creature or planeswalker', label: 'target creature or planeswalker' }],
    onResolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
  },
  "Kolaghan's Command": {
    modal: {
      min: 2,
      max: 2,
      modes: [
        {
          text: 'Return target creature card from your graveyard to your hand',
          targets: [{ type: 'graveyard card', who: 'you', label: 'target creature card in your graveyard', filter: (_g, c) => isCreature(c) }],
          resolve: (g, { targets }) => {
            const c = refGraveyard(g, targets[0]);
            if (!c) return;
            log(g, `${c.name} returns to its owner's hand.`, c.owner, [c]);
            moveCard(g, c, 'hand');
          },
        },
        {
          // "Target player discards a card." That player chooses (701.9a).
          text: 'Target player discards a card',
          targets: [targetPlayer],
          resolve: (g, { targets }) => {
            const p = refPlayer(g, targets[0]);
            if (p) chooseToDiscard(g, p.id, 1);
          },
        },
        {
          text: 'Destroy target artifact',
          targets: [typed('target artifact', ['Artifact'])],
          resolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
        },
        {
          text: "Kolaghan's Command deals 2 damage to any target",
          targets: [anyTarget],
          resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 2),
        },
      ],
    },
  },
  Blightning: {
    // "Blightning deals 3 damage to target player or planeswalker. That player or that planeswalker's controller discards two cards."
    targets: [{ type: 'player or planeswalker', label: 'target player or planeswalker' }],
    onResolve: (g, { self, targets }) => {
      const t = targets[0];
      const walker = refCard(g, t);
      // The planeswalker's controller as the damage is dealt, even if it then dies (608.2h).
      const pid = t?.kind === 'player' ? t.id : walker && isPlaneswalker(walker) ? walker.controller : undefined;
      dealDamage(g, self, t, 3);
      if (pid !== undefined && !g.players[pid].lost) chooseToDiscard(g, pid, 2);
    },
  },
  'Village Rites': {
    // "As an additional cost to cast this spell, sacrifice a creature. Draw two cards."
    additionalCost: { sacrifice: yourCreature },
    onResolve: (g, { you }) => draw(g, you, 2),
  },
  Fling: {
    // "As an additional cost to cast this spell, sacrifice a creature. Fling deals damage equal
    // to the sacrificed creature's power to any target." Its power as it was sacrificed (608.2h).
    additionalCost: { sacrifice: yourCreature },
    targets: [anyTarget],
    onResolve: (g, { self, targets, sacrificedPower }) => void dealDamage(g, self, targets[0], Math.max(0, sacrificedPower?.[0] ?? 0)),
  },
  'Deadly Dispute': {
    // "As an additional cost to cast this spell, sacrifice an artifact or creature. Draw two cards and create a Treasure token."
    additionalCost: { sacrifice: { type: 'permanent', who: 'you', label: 'an artifact or creature to sacrifice', filter: (_g, c) => hasType(c, 'Artifact') || isCreature(c) } },
    onResolve: (g, { you }) => {
      draw(g, you, 2);
      createToken(g, you, 'Treasure');
    },
  },

  // ===== Red-green =====
  'Halana and Alena, Partners': {
    // "At the beginning of combat on your turn, put X +1/+1 counters on another target
    // creature you control, where X is Halana and Alena's power. That creature gains haste
    // until end of turn."
    onBeginCombat: {
      when: (_g, { self, player }) => player === self.controller,
      targets: [{ type: 'creature', who: 'you', label: 'another target creature you control', filter: (_g, c, source) => c.id !== source.id }],
      resolve: (g, { self, targets }) => {
        const c = refCard(g, targets[0]);
        if (!c) return;
        // Their power as the ability resolves, or as it last was if they have left (608.2h).
        addCounters(g, c, stats(g, abilitySource(g) ?? self).power);
        pump(g, c, 0, 0, ['haste']);
      },
    },
  },
  'Savage Ventmaw': {
    // "Whenever this creature attacks, add {R}{R}{R}{G}{G}{G}. Until end of turn, you don't lose this mana as steps and phases end."
    onAttack: (g, { self, you }) => addMana(g, you, ['R', 'R', 'R', 'G', 'G', 'G'], self, { keep: true }),
  },
  // Two triggered abilities for the same event, each triggering on its own (603.2).
  'Dragon Tempest': {
    onCreatureEnters: [
      {
        // "Whenever a creature you control with flying enters, it gains haste until end of turn."
        text: 'A creature with flying gains haste',
        when: (g, { self, entered }) => entered.controller === self.controller && has(g, permanent(g, entered.id) ?? entered, 'flying'),
        resolve: (g, { entered }) => pump(g, sameObject(g, entered), 0, 0, ['haste']),
      },
      {
        // "Whenever a Dragon you control enters, it deals X damage to any target, where X is
        // the number of Dragons you control." The Dragon deals it, as it last was if it has
        // left; X is counted as the ability resolves (608.2h).
        text: 'The Dragon deals damage equal to your Dragons',
        when: (_g, { self, entered }) => entered.controller === self.controller && isDragon(entered),
        targets: [anyTarget],
        resolve: (g, { you, entered, targets }) => {
          const dragons = battlefield(g).filter((c) => c.controller === you && isDragon(c)).length;
          dealDamage(g, sameObject(g, entered) ?? entered, targets[0], dragons);
        },
      },
    ],
  },
  'Atarka, World Render': {
    // "Whenever a Dragon you control attacks, it gains double strike until end of turn."
    onCreatureAttacks: {
      when: dragonOfYoursAttacks,
      resolve: (g, { attacker }) => pump(g, sameObject(g, attacker), 0, 0, ['double strike']),
    },
  },
  'Ghor-Clan Rampager': {
    // "Bloodrush — {R}{G}, Discard this card: Target attacking creature gets +4/+4 and gains trample until end of turn."
    activated: {
      fromHand: true,
      cost: { mana: '{R}{G}', discardSelf: true },
      targets: [{ type: 'creature', label: 'target attacking creature', filter: (g, c) => (g.combat?.attacks ?? []).some((a) => a.id === c.id) }],
      text: 'Bloodrush — {R}{G}, discard this card: target attacking creature gets +4/+4 and gains trample until end of turn',
      resolve: (g, { targets }) => pump(g, refCard(g, targets[0]), 4, 4, ['trample']),
    },
  },
  "Domri's Ambush": {
    // "Put a +1/+1 counter on target creature you control. Then that creature deals damage
    // equal to its power to target creature or planeswalker you don't control."
    targets: [{ type: 'creature', who: 'you', label: 'target creature you control' }, { type: 'creature or planeswalker', who: 'opponent', label: "target creature or planeswalker you don't control" }],
    onResolve: (g, { targets }) => {
      // An illegal target is neither changed nor made to do anything (608.2b).
      const mine = refCard(g, targets[0]);
      if (!mine) return;
      addCounters(g, mine, 1);
      if (refCard(g, targets[1])) dealDamage(g, mine, targets[1], Math.max(0, stats(g, mine).power));
    },
  },
  Decimate: {
    // "Destroy target artifact, target creature, target enchantment, and target land." All
    // four are needed to cast it; one object may be more than one of them (115.3).
    targets: [typed('target artifact', ['Artifact']), { type: 'creature', label: 'target creature' }, typed('target enchantment', ['Enchantment']), typed('target land', ['Land'])],
    onResolve: (g, { targets }) => destroyMany(g, [...new Set(refCards(g, targets))]),
  },
  'Return of the Wildspeaker': {
    modal: {
      min: 1,
      max: 1,
      modes: [
        {
          text: 'Draw cards equal to the greatest power among non-Human creatures you control',
          resolve: (g, { you }) => draw(g, you, Math.max(0, ...nonHumans(g, you).map((c) => stats(g, c).power))),
        },
        {
          text: 'Non-Human creatures you control get +3/+3 until end of turn',
          resolve: (g, { you }) => {
            for (const c of nonHumans(g, you)) pump(g, c, 3, 3);
          },
        },
      ],
    },
  },
  'Temur Battle Rage': {
    // "Target creature gains double strike until end of turn. Ferocious — That creature also
    // gains trample until end of turn if you control a creature with power 4 or greater."
    targets: [{ type: 'creature', label: 'target creature' }],
    onResolve: (g, { you, targets }) => {
      const c = refCard(g, targets[0]);
      if (c) pump(g, c, 0, 0, ferocious(g, you) ? ['double strike', 'trample'] : ['double strike']);
    },
  },
  'Raging Swordtooth': {
    // "When this creature enters, it deals 1 damage to each other creature."
    onEnter: (g, { self }) => {
      for (const c of allCreatures(g)) if (c.id !== self.id) damageCard(g, self, c, 1);
    },
  },
  'Dragonmaster Outcast': {
    // "At the beginning of your upkeep, if you control six or more lands, create a 5/5 red
    // Dragon creature token with flying." An intervening "if": checked as it triggers and
    // again as it resolves (603.4).
    onUpkeep: {
      when: (g, { self, player }) => player === self.controller && sixLands(g, player),
      resolve: (g, { you }) => {
        if (sixLands(g, you)) createToken(g, you, 'Dragon 5/5 flying');
      },
    },
  },
  "Crater's Claws": {
    // "Crater's Claws deals X damage to any target. Ferocious — Crater's Claws deals X plus 2
    // damage instead if you control a creature with power 4 or greater." Checked as it resolves.
    targets: [anyTarget],
    onResolve: (g, { self, you, targets }) => {
      const x = self.cast?.x ?? 0;
      dealDamage(g, self, targets[0], ferocious(g, you) ? x + 2 : x);
    },
  },
  "Dragonlord's Servant": {
    // "Dragon spells you cast cost {1} less to cast."
    costModifier: (_g, self, spell, caster) => (caster === self.controller && hasType(spell, 'Dragon') ? -1 : 0),
  },
  'Utvara Hellkite': {
    // "Whenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying."
    onCreatureAttacks: { when: dragonOfYoursAttacks, resolve: (g, { you }) => void createToken(g, you, 'Dragon 6/6 flying') },
  },
  'Shamanic Revelation': {
    // "Draw a card for each creature you control. Ferocious — You gain 4 life for each creature you control with power 4 or greater."
    onResolve: (g, { you }) => {
      draw(g, you, creaturesOf(g, you).length);
      const big = creaturesOf(g, you).filter((c) => stats(g, c).power >= 4).length;
      if (big) gainLife(g, you, 4 * big);
    },
  },
  'Verix Bladewing': {
    kicker: { mana: '{3}' },
    // "When Verix Bladewing enters, if it was kicked, create Karox Bladewing, a legendary 4/4
    // red Dragon creature token with flying." Kicked or not can't change, so checking it as
    // it triggers is enough (603.4).
    onEnter: { when: (_g, { self }) => !!self.cast?.kicked, resolve: (g, { you }) => void createToken(g, you, 'Karox Bladewing') },
  },

  // ===== Green-white =====
  "Trostani, Selesnya's Voice": {
    // "Whenever another creature you control enters, you gain life equal to that creature's toughness."
    onCreatureEnters: {
      when: (_g, { self, entered }) => entered.id !== self.id && entered.controller === self.controller,
      // Its toughness now, or as it last was if it has left (608.2h).
      resolve: (g, { you, entered }) => gainLife(g, you, Math.max(0, stats(g, permanent(g, entered.id) ?? entered).toughness)),
    },
    // "{1}{G}{W}, {T}: Populate."
    activated: {
      cost: { mana: '{1}{G}{W}', tap: true },
      text: '{1}{G}{W}, {T}: populate (copy a creature token you control)',
      resolve: (g, { you }) => void populate(g, you),
    },
  },
  'Selesnya Charm': {
    modal: {
      min: 1,
      max: 1,
      modes: [
        {
          text: 'Target creature gets +2/+2 and gains trample until end of turn',
          targets: [{ type: 'creature', label: 'target creature' }],
          resolve: (g, { targets }) => pump(g, refCard(g, targets[0]), 2, 2, ['trample']),
        },
        {
          text: 'Exile target creature with power 5 or greater',
          targets: [{ type: 'creature', label: 'target creature with power 5 or greater', filter: (g, c) => stats(g, c).power >= 5 }],
          resolve: (g, { targets }) => exile(g, refCard(g, targets[0])),
        },
        {
          text: 'Create a 2/2 white Knight creature token with vigilance',
          resolve: (g, { you }) => void createToken(g, you, 'Knight 2/2 vigilance'),
        },
      ],
    },
  },
  "Trostani's Summoner": {
    // "When this creature enters, create a 2/2 white Knight creature token with vigilance, a
    // 3/3 green Centaur creature token, and a 4/4 green Rhino creature token with trample."
    onEnter: (g, { you }) => {
      createToken(g, you, 'Knight 2/2 vigilance');
      createToken(g, you, 'Centaur');
      createToken(g, you, 'Rhino 4/4 trample');
    },
  },
  'Armada Wurm': {
    // "When this creature enters, create a 5/5 green Wurm creature token with trample."
    onEnter: (g, { you }) => void createToken(g, you, 'Wurm 5/5 trample'),
  },
  'Emmara, Soul of the Accord': {
    // "Whenever Emmara becomes tapped, create a 1/1 white Soldier creature token with lifelink."
    onTapped: (g, { you }) => void createToken(g, you, 'Soldier 1/1 lifelink'),
  },
  'Growing Ranks': {
    // "At the beginning of your upkeep, populate."
    onUpkeep: { when: (_g, { self, player }) => player === self.controller, resolve: (g, { you }) => void populate(g, you) },
  },
  'Rootborn Defenses': {
    // "Populate. Creatures you control gain indestructible until end of turn." In that order,
    // so the new token is indestructible too. If the player chooses which token to copy, the
    // rest waits for the choice.
    onResolve: (g, { you }) => {
      if (!populate(g, you, 'populated')) indestructibleTeam(g, you);
    },
    then: {
      populated: (g, { you, picked }) => {
        copyToken(g, you, picked[0]);
        indestructibleTeam(g, you);
      },
    },
  },
  'Sundering Growth': {
    // "Destroy target artifact or enchantment, then populate."
    targets: [typed('target artifact or enchantment', ['Artifact', 'Enchantment'])],
    onResolve: (g, { you, targets }) => {
      destroy(g, refCard(g, targets[0]));
      populate(g, you);
    },
  },
  'Scion of Vitu-Ghazi': {
    // "When this creature enters, if you cast it from your hand, create a 1/1 white Bird
    // creature token with flying, then populate." Where it was cast from can't change (603.4).
    onEnter: {
      when: (_g, { self }) => self.cast?.from === 'hand',
      resolve: (g, { you }) => {
        createToken(g, you, 'Bird 1/1 flying');
        populate(g, you);
      },
    },
  },
  'Collective Blessing': {
    // "Creatures you control get +3/+3."
    static: (_g, self, c) => (c.controller === self.controller ? { power: 3, toughness: 3 } : null),
  },
  'Advent of the Wurm': { onResolve: (g, { you }) => void createToken(g, you, 'Wurm 5/5 trample') },
  'Unflinching Courage': {
    // "Enchant creature. Enchanted creature gets +2/+2 and has trample and lifelink."
    enchant: { type: 'creature', label: 'target creature' },
    static: attachedBonus({ power: 2, toughness: 2, keywords: ['trample', 'lifelink'] }),
  },
  'Trostani Discordant': {
    // "Other creatures you control get +1/+1."
    static: (_g, self, c) => (c.id !== self.id && c.controller === self.controller ? { power: 1, toughness: 1 } : null),
    // "When Trostani enters, create two 1/1 white Soldier creature tokens with lifelink."
    onEnter: (g, { you }) => void createToken(g, you, 'Soldier 1/1 lifelink', 2),
    // "At the beginning of your end step, each player gains control of all creatures they own."
    onEndStep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g) => {
        for (const c of allCreatures(g)) if (c.controller !== c.owner) gainControl(g, c, c.owner);
      },
    },
  },
  'Call of the Conclave': { onResolve: (g, { you }) => void createToken(g, you, 'Centaur') },

  // ===== Lands =====
  'Rugged Highlands': gainLand(['R', 'G']),
  'Blossoming Sands': gainLand(['G', 'W']),
  'Karplusan Forest': painLand(['R', 'G']),
  Brushland: painLand(['G', 'W']),
  'Rootbound Crag': checkLand(['R', 'G'], ['Mountain', 'Forest']),
  'Sunpetal Grove': checkLand(['G', 'W'], ['Forest', 'Plains']),
  'Stomping Ground': shockLand,
  'Temple Garden': shockLand,
  'Scoured Barrens': gainLand(['W', 'B']),
  'Bloodfell Caves': gainLand(['B', 'R']),
  'Caves of Koilos': painLand(['W', 'B']),
  'Sulfurous Springs': painLand(['B', 'R']),
  'Isolated Chapel': checkLand(['W', 'B'], ['Plains', 'Swamp']),
  'Dragonskull Summit': checkLand(['B', 'R'], ['Swamp', 'Mountain']),
  'Godless Shrine': shockLand,
  'Blood Crypt': shockLand,
});
