import { play } from './sound';
import { useStore } from './store';

const LEVELS = [0, 0.25, 0.5, 0.75, 1];
const percent = (volume: number) => `${Math.round(volume * 100)}%`;

/** The menu's mute button and volume slider for the interface sounds. Letting go of the slider plays a click at the new volume. */
export function SoundControl() {
  const volume = useStore((s) => s.settings.volume);
  const muted = useStore((s) => s.settings.muted);
  const set = useStore((s) => s.setSetting);
  const off = muted || volume === 0;
  return (
    <div className="menu-sound">
      <button onClick={() => set({ muted: !muted })} aria-pressed={muted} title={muted ? 'Turn sounds on' : 'Turn sounds off'}>
        {off ? 'Sound off' : 'Sound'}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(volume * 100)}
        aria-label="Sound volume"
        title={`Volume ${percent(volume)}`}
        disabled={muted}
        onChange={(e) => set({ volume: Number(e.target.value) / 100 })}
        onPointerUp={() => play('click')}
        onKeyUp={() => play('click')}
      />
    </div>
  );
}

/** One button that steps the volume up through `LEVELS` and round to off, like the bot speed button. */
export function SoundButton() {
  const volume = useStore((s) => s.settings.volume);
  const muted = useStore((s) => s.settings.muted);
  const off = muted || volume === 0;
  const next = () => {
    const level = off ? 0 : volume;
    const up = LEVELS.find((l) => l > level + 0.01) ?? 0;
    useStore.getState().setSetting({ volume: up, muted: false });
    // Heard at the new volume, instead of the usual click at the old one.
    play('click');
  };
  return (
    <button data-silent onClick={next} title="Sound volume">
      Sound {off ? 'off' : percent(volume)}
    </button>
  );
}
