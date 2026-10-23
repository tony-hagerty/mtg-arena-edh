// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (ward-ring group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care.
//
// The rest of the group is read by the parser, with the templates and engine rules added for
// it: ward with a sacrifice cost (702.21a), ward {N} among other keywords, amass (701.47), the
// Ring tempts you (701.54), partner with (702.124j), types and an activated ability given by a
// static ability (205.1b, 613.1d, 613.1f), activated abilities costing less (602.2b),
// protection from colours (702.16), and "loses life for the first time during each of their
// turns".
import { damageCard, damagePlayer, permanent } from '../../engine/rules';
import { registerScripts } from '../../engine/registry';

registerScripts({
  'Ghyrson Starn, Kelermorph': {
    // "Ward {2}" (702.21a).
    ward: { mana: '{2}' },
    // "Three Autostubs — Whenever another source you control deals exactly 1 damage to a
    // permanent or player, Ghyrson Starn deals 2 damage to that permanent or player."
    // "Three Autostubs" is a flavor word (207.2d). Each permanent or player dealt exactly 1 is
    // its own event (603.2c): damage dealt to several at once triggers once for each. The
    // source is whoever controlled it as it dealt the damage (a spell: its caster).
    onDamage: {
      when: (_g, { self, source, amount }) => amount === 1 && source.id !== self.id && source.controller === self.controller,
      resolve: (g, { self, player, card }) => {
        // Ghyrson deals it as it is now, or as it last was if it has left (113.7a, 608.2h).
        const source = permanent(g, self.id) ?? self;
        if (player !== null) damagePlayer(g, source, player, 2);
        else if (card) {
          // "That permanent": only if it is still the same object (400.7).
          const now = permanent(g, card.id);
          if (now && now.moves === card.moves) damageCard(g, source, now, 2, false, true);
        }
      },
    },
  },
});
