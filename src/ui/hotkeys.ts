// Every key and mouse control the game answers, for the Hotkeys window on the gear menu.
// The handlers are in ActionBar (Hud.tsx) and fullscreen.ts: a key added there goes here too.

/** One control: `keys` are alternatives, each a combination like `['Ctrl', 'Z']`. */
export interface Hotkey {
  keys: string[][];
  does: string;
}

export interface HotkeyGroup {
  title: string;
  /** Keys are drawn as key caps; mouse actions as plain words. */
  mouse?: boolean;
  rows: Hotkey[];
}

/** A Mac, where Cmd stands in for Ctrl in undo and pay-and-hold, and Alt is called Option. */
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function hotkeys(mac = MAC): HotkeyGroup[] {
  const mod = mac ? 'Cmd' : 'Ctrl';
  return [
    {
      title: 'Keyboard',
      rows: [
        { keys: [['Space'], ['Enter']], does: 'Press the big button: pass, attack, block, pay or done.' },
        { keys: [['Esc']], does: 'Close a bigger card view, press the second button, or cancel a spell or ability.' },
        { keys: [[mod, 'Z']], does: 'Undo the last step that can be: a mana choice, a choice while casting, mana you made, or an attacker or blocker picked.' },
        { keys: [[mod, 'Space']], does: 'Pay, and keep priority afterwards.' },
        { keys: [['Ctrl', 'Shift']], does: 'Press the two alone, then let go: full control on or off.' },
        { keys: [[mac ? 'Option' : 'Alt', 'Enter']], does: 'Fullscreen on or off.' },
      ],
    },
    {
      title: 'Mouse',
      mouse: true,
      rows: [
        { keys: [['Hover a card']], does: 'See it full size.' },
        { keys: [['Right-click a card']], does: 'A bigger view that stays up. Click off it to close.' },
        { keys: [['Drag from your hand']], does: 'Up toward the table: play a land or cast a spell. Sideways: sort your hand.' },
        { keys: [['Right-click a graveyard']], does: 'Look through it.' },
        { keys: [['Right-click the well']], does: 'Look through the exile.' },
        { keys: [['Hover a name in the log']], does: 'See the card.' },
      ],
    },
  ];
}
