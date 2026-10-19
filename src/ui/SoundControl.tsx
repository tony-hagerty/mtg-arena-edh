import type { ReactNode } from 'react';
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
    <VolumeControl
      what="sounds"
      volume={volume}
      muted={muted}
      setMuted={(m) => set({ muted: m })}
      setVolume={(v) => set({ volume: v })}
      onRelease={() => play('click')}
      icon={
        <>
          <path d="M4 9h3.5L12 5v14l-4.5-4H4Z" />
          {off ? (
            <path d="m16 9.5 5 5m0-5-5 5" fill="none" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" strokeWidth="2" strokeLinecap="round" />
          )}
        </>
      }
    />
  );
}

/** The same for the background music (music.ts), apart from the sounds. The music is heard changing as the slider moves. */
export function MusicControl() {
  const music = useStore((s) => s.settings.music);
  const muted = useStore((s) => s.settings.musicMuted);
  const set = useStore((s) => s.setSetting);
  const off = muted || music === 0;
  return (
    <VolumeControl
      what="music"
      volume={music}
      muted={muted}
      setMuted={(m) => set({ musicMuted: m })}
      setVolume={(v) => set({ music: v })}
      icon={
        <>
          {/* Two beamed eighth notes. */}
          <path d="M9 17.5a2.5 2.5 0 1 1-1.5-2.3V6l11-2.5v11a2.5 2.5 0 1 1-1.5-2.3V7.4l-8 1.8Z" />
          {off && <path d="m3 3 18 18" fill="none" strokeWidth="2" strokeLinecap="round" />}
        </>
      }
    />
  );
}

function VolumeControl({ what, volume, muted, setMuted, setVolume, onRelease, icon }: {
  what: 'sounds' | 'music';
  volume: number;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  onRelease?: () => void;
  icon: ReactNode;
}) {
  const off = muted || volume === 0;
  const toggle = muted ? `Turn ${what} on` : `Turn ${what} off`;
  const name = what === 'sounds' ? 'Sound' : 'Music';
  return (
    <div className="sound-control">
      <button className={cx('sound-mute', off && 'off')} onClick={() => setMuted(!muted)} aria-pressed={muted} aria-label={toggle} title={toggle}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {icon}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(volume * 100)}
        aria-label={`${name} volume`}
        title={`${name} ${percent(volume)}`}
        disabled={muted}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
      />
      <span className="sound-level">{off ? 'Off' : percent(volume)}</span>
    </div>
  );
}
