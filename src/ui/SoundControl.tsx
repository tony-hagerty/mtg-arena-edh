import { play } from './sound';
import { useStore } from './store';
import { cx } from './util';

const percent = (volume: number) => `${Math.round(volume * 100)}%`;

/**
 * A mute button and a volume slider for the interface sounds: on the menu, and in the game's
 * settings popover on the log bar. Letting go of the slider plays a click at the new volume.
 */
export function SoundControl() {
  const volume = useStore((s) => s.settings.volume);
  const muted = useStore((s) => s.settings.muted);
  const set = useStore((s) => s.setSetting);
  const off = muted || volume === 0;
  return (
    <div className="sound-control">
      <button className={cx('sound-mute', off && 'off')} onClick={() => set({ muted: !muted })} aria-pressed={muted} aria-label={muted ? 'Turn sounds on' : 'Turn sounds off'} title={muted ? 'Turn sounds on' : 'Turn sounds off'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9h3.5L12 5v14l-4.5-4H4Z" />
          {off ? (
            <path d="m16 9.5 5 5m0-5-5 5" fill="none" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" strokeWidth="2" strokeLinecap="round" />
          )}
        </svg>
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
      <span className="sound-level">{off ? 'Off' : percent(volume)}</span>
    </div>
  );
}
