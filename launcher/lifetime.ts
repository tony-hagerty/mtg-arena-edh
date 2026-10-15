// When the program quits: once the game window is closed.
//
// The Edge we start has its own profile folder, so it's a separate Edge from the user's
// everyday one and exits when its last window closes. That exit is the main signal. Edge
// can instead hand the window to an Edge already running on that profile (one left over
// from a crash, or a second double-click of the .exe) and exit at once. So once the Edge we
// started is gone, the program also waits for the game pages it served to close.
//
// While our Edge is running, closed pages alone never quit the program: a page that Edge
// puts to sleep, or one reloading slowly, must not take the game down with it.

export interface LifetimeOptions {
  quit: () => void;
  /** How long no page may be open, after one was, before quitting. Covers a reload. */
  graceMs?: number;
  /** How long to wait for a first page once Edge has handed off. */
  startupMs?: number;
}

export interface Lifetime {
  pageOpened(): void;
  pageClosed(): void;
  /** The Edge process the program started has exited (or none could be started). */
  browserExited(): void;
}

export function createLifetime({ quit, graceMs = 3_000, startupMs = 30_000 }: LifetimeOptions): Lifetime {
  let open = 0;
  let seen = false;
  let exited = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!exited || open > 0) return;
    timer = setTimeout(quit, seen ? graceMs : startupMs);
  };

  return {
    pageOpened() {
      open++;
      seen = true;
      check();
    },
    pageClosed() {
      open = Math.max(0, open - 1);
      check();
    },
    browserExited() {
      exited = true;
      check();
    },
  };
}
