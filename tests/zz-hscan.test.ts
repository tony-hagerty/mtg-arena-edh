import { it } from 'vitest';
import { ALL_DECKS } from '../src/cards/db';
import { unsupported } from '../src/cards/support';
import '../src/engine';
it('scan', () => {
  const d = ALL_DECKS.find((x) => x.id === 'hashaton')!;
  const out: string[] = [];
  for (const n of [...d.commanders, ...d.cards]) { const p = unsupported(n); if (p.length) out.push(`${n}: ${p.join('; ')}`); }
  console.log(out.length + '\n' + out.join('\n'));
});
