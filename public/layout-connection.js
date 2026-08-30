(() => {
  if (window.__burtnieksLayoutConnectionReady) return;
  window.__burtnieksLayoutConnectionReady = true;

  function arrangeGameLayout() {
    const game = document.getElementById('game');
    const side = game?.querySelector(':scope > .side');
    const boardCard = game?.querySelector(':scope > .board-card');
    if (!game || !side || !boardCard) return;

    let strip = game.querySelector(':scope > .game-top-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'game-top-strip';
      game.insertBefore(strip, boardCard);
    }

    const statusPanel = [...side.children].find((panel) => panel.querySelector?.('#turnBanner'));
    const lobbyPanel = document.getElementById('lobbyPanel');
    if (statusPanel) {
      statusPanel.classList.add('game-status-panel');
      strip.appendChild(statusPanel);
    }
    if (lobbyPanel) {
      strip.appendChild(lobbyPanel);

      const sectionTitle = lobbyPanel.querySelector(':scope > .section-title');
      if (sectionTitle) sectionTitle.textContent = 'Istabas iestatījumi';

      const actionRow = lobbyPanel.querySelector(':scope > .row');
      const readyButton = document.getElementById('ready');
      if (actionRow && readyButton && readyButton.parentElement !== actionRow) {
        actionRow.appendChild(readyButton);
      }
    }

    window.dispatchEvent(new Event('resize'));
  }

  function withTimeout(milliseconds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), milliseconds);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
  }

  async function diagnoseConnection() {
    const statusChip = document.querySelector('.status-chip');
    const connection = document.getElementById('connection');
    if (!statusChip || !connection) return;
    const timeout = withTimeout(4000);
    try {
      const response = await fetch('/healthz', { cache: 'no-store', signal: timeout.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      statusChip.classList.remove('connection-error');
      statusChip.classList.add('connection-warning');
      connection.textContent = 'Socket.IO savienojums bloķēts';
      statusChip.title = 'HTTP serveris atbild, bet Socket.IO savienojums neizdodas. Pārbaudi Nginx /socket.io/ proxy_set_header Upgrade iestatījumus.';
    } catch {
      statusChip.classList.remove('connection-warning');
      statusChip.classList.add('connection-error');
      connection.textContent = 'Serveris nav sasniedzams';
      statusChip.title = 'Pārbaudi: systemctl status burtnieks un journalctl -u burtnieks.';
    } finally {
      timeout.done();
    }
  }

  const socket = window.__burtnieksSocket;
  if (socket) {
    socket.on('connect', () => {
      const statusChip = document.querySelector('.status-chip');
      statusChip?.classList.remove('connection-warning', 'connection-error');
      if (statusChip) statusChip.title = '';
    });
    socket.on('connect_error', diagnoseConnection);
    socket.io?.on('reconnect_attempt', () => {
      const connection = document.getElementById('connection');
      if (connection) connection.textContent = 'Atjauno savienojumu…';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrangeGameLayout, { once: true });
  } else {
    arrangeGameLayout();
  }
})();