// Alt+Enter toggles fullscreen, as in most Windows games. It's the browser's own fullscreen,
// so there's no button for it on screen. A key press counts as the user's say-so, which the
// browser requires before it lets a page go fullscreen.
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => {});
}

window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Enter' || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
    // Holding the keys down repeats the press; toggle once.
    e.preventDefault();
    if (!e.repeat) toggleFullscreen();
  },
  { capture: true },
);
