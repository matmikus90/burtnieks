(() => {
  if (window.__burtnieksTouchChatReady) return;
  window.__burtnieksTouchChatReady = true;

  const chat = document.getElementById('chat');
  const head = chat?.querySelector('.chat-head');
  const toggle = document.getElementById('chatToggle');
  const side = document.querySelector('#game > .side');
  if (!chat || !head || !toggle || !side) return;

  const storageKey = 'burtnieks:chat-position';
  const desktopQuery = window.matchMedia('(min-width:1051px)');
  let dragging = null;
  let frame = 0;

  let actions = head.querySelector('.chat-head-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'chat-head-actions';
    head.appendChild(actions);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn ghost chat-drag-reset';
  reset.textContent = '↘';
  reset.title = 'Atiestatīt čatu apakšējā labajā stūrī';
  reset.setAttribute('aria-label', reset.title);
  actions.append(reset, toggle);

  function clearPosition() {
    chat.style.left = '';
    chat.style.top = '';
    chat.style.right = '';
    chat.style.bottom = '';
  }

  function clampPosition(left, top) {
    const margin = 10;
    const width = chat.offsetWidth || 360;
    const height = chat.offsetHeight || 70;
    return {
      left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin)),
      top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin)),
    };
  }

  function savePosition(left, top) {
    try { localStorage.setItem(storageKey, JSON.stringify({ left, top })); } catch {}
  }

  function restorePosition() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch {}
    if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
      const position = clampPosition(saved.left, saved.top);
      chat.style.left = `${position.left}px`;
      chat.style.top = `${position.top}px`;
      chat.style.right = 'auto';
      chat.style.bottom = 'auto';
      return;
    }
    chat.style.left = 'auto';
    chat.style.top = 'auto';
    chat.style.right = '16px';
    chat.style.bottom = '16px';
  }

  function applyResponsiveMode() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      dragging = null;
      chat.classList.remove('dragging');
      if (!desktopQuery.matches) {
        chat.classList.remove('chat-floating');
        chat.classList.add('chat-inline');
        clearPosition();
        if (chat.parentElement !== side) side.appendChild(chat);
      } else {
        chat.classList.remove('chat-inline');
        chat.classList.add('chat-floating');
        if (chat.parentElement !== document.body) document.body.appendChild(chat);
        restorePosition();
      }
      window.dispatchEvent(new Event('resize'));
    });
  }

  function resetPosition() {
    try { localStorage.removeItem(storageKey); } catch {}
    if (desktopQuery.matches) restorePosition();
  }

  reset.addEventListener('click', (event) => {
    event.stopPropagation();
    resetPosition();
  });

  head.addEventListener('dblclick', (event) => {
    if (event.target.closest('button')) return;
    resetPosition();
  });

  head.addEventListener('pointerdown', (event) => {
    if (!desktopQuery.matches || event.button !== 0 || event.target.closest('button,input')) return;
    const rect = chat.getBoundingClientRect();
    dragging = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    chat.style.left = `${rect.left}px`;
    chat.style.top = `${rect.top}px`;
    chat.style.right = 'auto';
    chat.style.bottom = 'auto';
    chat.classList.add('dragging');
    head.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  head.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const position = clampPosition(
      dragging.left + event.clientX - dragging.startX,
      dragging.top + event.clientY - dragging.startY,
    );
    chat.style.left = `${position.left}px`;
    chat.style.top = `${position.top}px`;
  });

  function finishDrag(event) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const rect = chat.getBoundingClientRect();
    const position = clampPosition(rect.left, rect.top);
    chat.style.left = `${position.left}px`;
    chat.style.top = `${position.top}px`;
    savePosition(position.left, position.top);
    chat.classList.remove('dragging');
    head.releasePointerCapture?.(event.pointerId);
    dragging = null;
  }

  head.addEventListener('pointerup', finishDrag);
  head.addEventListener('pointercancel', finishDrag);
  desktopQuery.addEventListener?.('change', applyResponsiveMode);
  window.addEventListener('resize', () => {
    if (!desktopQuery.matches || !chat.classList.contains('chat-floating')) return;
    const rect = chat.getBoundingClientRect();
    const position = clampPosition(rect.left, rect.top);
    chat.style.left = `${position.left}px`;
    chat.style.top = `${position.top}px`;
  }, { passive: true });

  const rackTitle = document.getElementById('rackTitle');
  if (rackTitle && !document.getElementById('tapTileHint')) {
    const hint = document.createElement('div');
    hint.id = 'tapTileHint';
    hint.className = 'notice tap-tile-hint';
    hint.textContent = 'Planšetē: pieskaries kauliņam, tad lauciņam. Vilkšana joprojām darbojas.';
    rackTitle.insertAdjacentElement('afterend', hint);
  }

  applyResponsiveMode();
})();
