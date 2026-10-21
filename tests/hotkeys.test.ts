// The Hotkeys window's list (src/ui/hotkeys.ts) names every key the game answers.
import { describe, expect, it } from 'vitest';
import { hotkeys } from '../src/ui/hotkeys';

const combos = (mac: boolean) => hotkeys(mac).flatMap((g) => g.rows.flatMap((r) => r.keys.map((k) => k.join('+'))));

describe('hotkeys', () => {
  it('lists each key the action bar and fullscreen handle', () => {
    expect(combos(false)).toEqual(expect.arrayContaining(['Space', 'Enter', 'Esc', 'Ctrl+Z', 'Ctrl+Space', 'Ctrl+Shift', 'Alt+Enter']));
  });

  it('names a Mac’s keys: Cmd for undo and pay-and-hold, Option for fullscreen', () => {
    const mac = combos(true);
    expect(mac).toEqual(expect.arrayContaining(['Cmd+Z', 'Cmd+Space', 'Option+Enter']));
    // Full control reads the Ctrl key itself, on a Mac too.
    expect(mac).toContain('Ctrl+Shift');
    expect(mac).not.toContain('Ctrl+Z');
  });

  it('describes every control', () => {
    for (const g of hotkeys(false)) for (const r of g.rows) expect(r.does.length).toBeGreaterThan(0);
  });
});
