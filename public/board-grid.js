(() => {
  if (window.__burtnieksBoardGridReady) return;
  window.__burtnieksBoardGridReady = true;

  const TRACKS = 15;
  let frame = 0;

  function snapToDevicePixel(value, devicePixelRatio) {
    const ratio = Number(devicePixelRatio) || 1;
    return Math.max(1 / ratio, Math.round(value * ratio) / ratio);
  }

  function synchronizeBoardGrid() {
    const board = document.getElementById('board');
    if (!board) return;

    const rootStyle = getComputedStyle(document.documentElement);
    const rawCell = Number.parseFloat(rootStyle.getPropertyValue('--cell')) || 42;
    const rawGap = Number.parseFloat(rootStyle.getPropertyValue('--gap')) || 2;
    const ratio = window.devicePixelRatio || 1;
    const cell = snapToDevicePixel(rawCell, ratio);
    const gap = snapToDevicePixel(rawGap, ratio);
    const size = TRACKS * cell + (TRACKS - 1) * gap;

    board.style.setProperty('--cell', `${cell}px`);
    board.style.setProperty('--gap', `${gap}px`);
    board.style.setProperty('--board-cell', `${cell}px`);
    board.style.setProperty('--board-gap', `${gap}px`);
    board.style.setProperty('--board-size', `${size}px`);
  }

  function scheduleSynchronization() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(synchronizeBoardGrid);
  }

  window.addEventListener('resize', scheduleSynchronization, { passive: true });
  window.addEventListener('orientationchange', scheduleSynchronization, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleSynchronization, { passive: true });
  document.fonts?.ready?.then(scheduleSynchronization).catch(() => {});

  scheduleSynchronization();
})();
