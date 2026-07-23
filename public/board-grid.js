(() => {
  if (window.__burtnieksBoardGridReady) return;
  window.__burtnieksBoardGridReady = true;

  const TRACKS = 15;
  const DESKTOP_MAX_BOARD = 780;
  const TABLET_MAX_BOARD = 720;
  const MIN_BOARD = 300;
  let frame = 0;
  let observedContainer = null;
  let resizeObserver = null;

  function snapDownToDevicePixel(value, devicePixelRatio) {
    const ratio = Number(devicePixelRatio) || 1;
    return Math.max(1 / ratio, Math.floor(value * ratio) / ratio);
  }

  function contentWidth(element) {
    if (!element) return window.innerWidth || MIN_BOARD;
    const style = getComputedStyle(element);
    const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    return Math.max(MIN_BOARD, element.clientWidth - padding);
  }

  function targetBoardSize(board) {
    const availableWidth = contentWidth(board.parentElement);
    const viewportHeight = window.visualViewport?.height || window.innerHeight || availableWidth;
    const desktop = window.matchMedia('(min-width:1051px)').matches;
    const maxBoard = desktop ? DESKTOP_MAX_BOARD : TABLET_MAX_BOARD;
    const verticalReserve = desktop ? 120 : 90;
    const availableHeight = Math.max(MIN_BOARD, viewportHeight - verticalReserve);
    return Math.min(availableWidth, availableHeight, maxBoard);
  }

  function observeContainer(board) {
    const container = board.parentElement;
    if (!container || observedContainer === container || typeof ResizeObserver === 'undefined') return;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(scheduleSynchronization);
    resizeObserver.observe(container);
    observedContainer = container;
  }

  function synchronizeBoardGrid() {
    const board = document.getElementById('board');
    if (!board) return;
    observeContainer(board);

    const rootStyle = getComputedStyle(document.documentElement);
    const rawGap = Math.max(1, Number.parseFloat(rootStyle.getPropertyValue('--gap')) || 2);
    const ratio = window.devicePixelRatio || 1;
    const gap = snapDownToDevicePixel(rawGap, ratio);
    const targetSize = targetBoardSize(board);
    const cell = snapDownToDevicePixel((targetSize - (TRACKS - 1) * gap) / TRACKS, ratio);
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleSynchronization, { once: true });

  scheduleSynchronization();
})();
