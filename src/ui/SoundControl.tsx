import { play } from './sound';
import { useStore } from './store';

const LEVELS = [0, 0.25, 0.5, 0.75, 1];
const percent = (volume: number) => `${Math.round(volume * 100)}%`;

/**
 * The menu's mute buttons and volume sliders, for the interface sounds and for the music.
 * Letting go of the sound slider plays a click at the new volume; the music is heard as it
 * moves.
 */
export function SoundControl() {
  return (
    <div className="menu-sound">
      <SoundSlider />
      <MusicSlider />
    </div>
  );
}

function SoundSlider() {
  const volume = useStore((s) => s.settings.volume);
  const muted = useStore((s) => s.settings.muted);
  const set = useStore((s) => s.setSetting);
  const off = muted || volume === 0;
  return (
    <div className="menu-sound-row">
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

function MusicSlider() {
  const music = useStore((s) => s.settings.music);
  const muted = useStore((s) => s.settings.musicMuted);
  const set = useStore((s) => s.setSetting);
  const off = muted || music === 0;
  return (
    <div className="menu-sound-row">
      <button onClick={() => set({ musicMuted: !muted })} aria-pressed={muted} title={muted ? 'Turn music on' : 'Turn music off'}>
        {off ? 'Music off' : 'Music'}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(music * 100)}
        aria-label="Music volume"
        title={`Music ${percent(music)}`}
        disabled={muted}
        onChange={(e) => set({ music: Number(e.target.value) / 100 })}
      />
    </div>
  );
}

/**
 * The log bar's sound buttons: the sound volume and the music volume, each stepping up through
 * `LEVELS` and round to off.
 */
export function SoundButton() {
  return (
    <>
      <SoundStepper />
      <MusicButton />
    </>
  );
}

function SoundStepper() {
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

/** Steps the music volume up through `LEVELS` and round to off. */
export function MusicButton() {
  const music = useStore((s) => s.settings.music);
  const muted = useStore((s) => s.settings.musicMuted);
  const off = muted || music === 0;
  const next = () => {
    const level = off ? 0 : music;
    useStore.getState().setSetting({ music: LEVELS.find((l) => l > level + 0.01) ?? 0, musicMuted: false });
  };
  return (
    <button onClick={next} title="Music volume">
      Music {off ? 'off' : percent(music)}
    </button>
  );
}
