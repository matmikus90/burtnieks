(() => {
  const socket = window.__burtnieksSocket;
  if (!socket || window.__burtnieksWordVoteReady) return;
  window.__burtnieksWordVoteReady = true;

  const chat = document.getElementById('chat');
  const chatHead = chat?.querySelector('.chat-head');
  if (!chat || !chatHead) return;

  const panel = document.createElement('section');
  panel.id = 'wordVotePanel';
  panel.className = 'word-vote-panel hidden';
  panel.setAttribute('aria-live', 'polite');
  chatHead.insertAdjacentElement('afterend', panel);

  let current = null;
  let countdownTimer = null;
  let hideTimer = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function myId() { return window.__burtnieksState?.meId || ''; }
  function roomId() { return window.__burtnieksState?.roomId || ''; }
  function wordsText(words) {
    return (Array.isArray(words) ? words : []).map((word) => String(word).toUpperCase()).join(', ');
  }

  function lockTurnActions() {
    if (!current) return;
    for (const id of ['commit', 'clear', 'pass', 'exchange']) {
      const button = document.getElementById(id);
      if (button) button.disabled = true;
    }
  }

  function stopCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function renderCountdown() {
    const countdown = panel.querySelector('[data-vote-countdown]');
    if (!countdown || !current?.expiresAt) return;
    const seconds = Math.max(0, Math.ceil((Number(current.expiresAt) - Date.now()) / 1000));
    countdown.textContent = `${seconds} s`;
  }

  function startCountdown() {
    stopCountdown();
    renderCountdown();
    countdownTimer = setInterval(renderCountdown, 250);
  }

  function showPanel(html) {
    clearTimeout(hideTimer);
    panel.innerHTML = html;
    panel.classList.remove('hidden');
    chat.classList.remove('min');
    lockTurnActions();
    startCountdown();
  }

  function hidePanel(delay = 0) {
    clearTimeout(hideTimer);
    const finish = () => {
      current = null;
      stopCountdown();
      panel.classList.add('hidden');
      panel.innerHTML = '';
    };
    if (delay > 0) hideTimer = setTimeout(finish, delay);
    else finish();
  }

  function renderOffer(effect) {
    current = { ...effect, mode: 'offer' };
    showPanel(`
      <div class="word-vote-topline"><b>Vārds nav atrasts Tēzaurā</b><span data-vote-countdown></span></div>
      <div class="word-vote-words">${escapeHtml(wordsText(effect.words))}</div>
      <p>Vari lūgt pārējiem cilvēku spēlētājiem vienbalsīgi pieņemt šo gājienu vai to atcelt.</p>
      <div class="word-vote-actions">
        <button type="button" class="btn primary" data-vote-start>Dot visiem balsot</button>
        <button type="button" class="btn ghost" data-vote-cancel>Atcelt</button>
      </div>
    `);
    panel.querySelector('[data-vote-start]')?.addEventListener('click', (event) => {
      event.currentTarget.disabled = true;
      socket.emit('startWordVote', { roomId: roomId() });
    });
    panel.querySelector('[data-vote-cancel]')?.addEventListener('click', () => {
      socket.emit('cancelWordVote', { roomId: roomId() });
    });
  }

  function renderVoting(effect) {
    const me = myId();
    const proposer = effect.by === me;
    const voter = Array.isArray(effect.voterIds) && effect.voterIds.includes(me);
    if (!proposer && !voter) { hidePanel(); return; }

    const acceptedIds = Array.isArray(effect.acceptedIds) ? effect.acceptedIds : [];
    const alreadyAccepted = acceptedIds.includes(me);
    current = { ...effect, mode: 'voting' };
    const count = Number(effect.acceptedCount || acceptedIds.length || 0);
    const total = Number(effect.totalCount || effect.voterIds?.length || 0);

    showPanel(`
      <div class="word-vote-topline"><b>🗳️ Vārda balsošana</b><span data-vote-countdown></span></div>
      <div class="word-vote-words">${escapeHtml(wordsText(effect.words))}</div>
      <p>${escapeHtml(effect.byName || 'Spēlētājs')} lūdz pieņemt Tēzaurā neatrastu vārdu.</p>
      <div class="word-vote-progress"><span>${count} no ${total} pieņēmuši</span><i><b style="width:${total ? Math.min(100, (count / total) * 100) : 0}%"></b></i></div>
      <div class="word-vote-actions">
        ${proposer
          ? '<button type="button" class="btn ghost" data-vote-cancel>Atcelt balsošanu</button>'
          : alreadyAccepted
            ? '<span class="word-vote-done">✓ Tavs balsojums iesniegts</span>'
            : '<button type="button" class="btn primary" data-vote-accept>Pieņemt</button><button type="button" class="btn danger" data-vote-reject>Noraidīt</button>'}
      </div>
    `);

    panel.querySelector('[data-vote-cancel]')?.addEventListener('click', () => socket.emit('cancelWordVote', { roomId: roomId() }));
    panel.querySelector('[data-vote-accept]')?.addEventListener('click', () => {
      panel.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      socket.emit('castWordVote', { roomId: roomId(), accept: true });
    });
    panel.querySelector('[data-vote-reject]')?.addEventListener('click', () => {
      panel.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      socket.emit('castWordVote', { roomId: roomId(), accept: false });
    });
  }

  function showResolution(effect) {
    if (!current) return;
    stopCountdown();
    panel.innerHTML = `
      <div class="word-vote-result ${effect.accepted ? 'accepted' : 'rejected'}">
        <b>${effect.accepted ? '✓ Gājiens pieņemts' : '✕ Gājiens nav pieņemts'}</b>
        <span>${escapeHtml(effect.reason || (effect.accepted ? 'Visi spēlētāji nobalsoja par.' : 'Balsošana beigusies.'))}</span>
      </div>
    `;
    hidePanel(1800);
  }

  socket.on('effect', (effect) => {
    if (!effect) return;
    if (effect.type === 'wordVoteOffer') renderOffer(effect);
    else if (effect.type === 'wordVoteStarted' || effect.type === 'wordVoteUpdate') renderVoting(effect);
    else if (effect.type === 'wordVoteCancelled') {
      if (current) {
        panel.innerHTML = `<div class="word-vote-result rejected"><b>Balsošana atcelta</b><span>${escapeHtml(effect.reason || '')}</span></div>`;
        hidePanel(1400);
      }
    } else if (effect.type === 'wordVoteResolved') showResolution(effect);
  });

  window.addEventListener('burtnieks:state', () => {
    if (current) setTimeout(lockTurnActions, 0);
  });
})();
