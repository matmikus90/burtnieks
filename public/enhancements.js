(() => {
  const socket = window.__burtnieksSocket;
  if (!socket) return;

  let audioContext = null;
  let soundEnabled = localStorage.getItem('burtnieks:sound') !== 'off';
  let previousTurnId = window.__burtnieksState?.turnId || null;
  let previousChatLength = window.__burtnieksState?.chat?.length || 0;

  function ensureAudio() {
    if (!soundEnabled) return null;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      return audioContext;
    } catch { return null; }
  }

  function playNotes(notes) {
    const context = ensureAudio();
    if (!context) return;
    let at = context.currentTime + 0.015;
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = note.type || 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(note.amplitude || 0.06, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + (note.duration || 0.12));
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(at); oscillator.stop(at + (note.duration || 0.12) + 0.03);
      at += note.gap || 0.09;
    }
  }

  function playSound(kind) {
    if (!soundEnabled) return;
    const sounds = {
      move: [{ frequency: 660 }, { frequency: 880 }],
      turn: [{ frequency: 523 }, { frequency: 784, duration: 0.16 }],
      chat: [{ frequency: 820, duration: 0.08 }],
      pass: [{ frequency: 330, duration: 0.11 }],
      error: [{ frequency: 220, duration: 0.14, type: 'square', amplitude: 0.035 }],
      gameOver: [{ frequency: 523 }, { frequency: 659 }, { frequency: 784, duration: 0.25 }],
      toggle: [{ frequency: 740, duration: 0.08 }],
    };
    playNotes(sounds[kind] || sounds.move);
  }

  const status = document.querySelector('.status-chip');
  if (status && !document.getElementById('soundToggle')) {
    const button = document.createElement('button');
    button.id = 'soundToggle'; button.type = 'button'; button.className = 'sound-toggle';
    function renderButton() {
      button.setAttribute('aria-pressed', String(soundEnabled));
      button.innerHTML = soundEnabled ? '🔊 <span>Skaņa</span>' : '🔇 <span>Skaņa</span>';
      button.title = soundEnabled ? 'Izslēgt skaņu' : 'Ieslēgt skaņu';
    }
    button.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('burtnieks:sound', soundEnabled ? 'on' : 'off');
      renderButton();
      if (soundEnabled) playSound('toggle');
    });
    renderButton(); status.prepend(button);
  }
  document.addEventListener('pointerdown', ensureAudio, { once: true, passive: true });

  socket.on('effect', (effect) => {
    if (effect.type === 'accepted') playSound('move');
    else if (['passed', 'timeout', 'exchanged'].includes(effect.type)) playSound('pass');
    else if (effect.type === 'gameOver') playSound('gameOver');
  });

  window.addEventListener('burtnieks:state', (event) => {
    const state = event.detail;
    const becameMyTurn = state.started && state.role === 'player' && state.turnId === state.meId && previousTurnId !== state.turnId;
    const chatLength = state.chat?.length || 0;
    const newest = state.chat?.[chatLength - 1];
    const myName = state.players?.find((player) => player.id === state.meId)?.name || '';
    if (becameMyTurn) playSound('turn');
    if (chatLength > previousChatLength && newest && newest.name !== myName) playSound('chat');
    previousTurnId = state.turnId; previousChatLength = chatLength;
  });

  async function checkWord(form) {
    const input = form.querySelector('[data-word-input]');
    const result = form.querySelector('[data-word-result]');
    const word = input.value.trim();
    if (!word) { result.className = 'word-result bad'; result.textContent = 'Ievadi vārdu.'; return; }
    result.className = 'word-result'; result.textContent = 'Pārbauda…';
    try {
      const response = await fetch(`/api/check-word?word=${encodeURIComponent(word)}`, { cache: 'no-store' });
      const data = await response.json();
      result.className = `word-result ${data.ok ? 'ok' : 'bad'}`;
      result.textContent = data.ok
        ? `✓ Atļauts${data.lemma && data.lemma !== data.word ? ` · pamatforma: ${data.lemma}` : ''}`
        : `✕ Nav atļauts · ${data.reason || 'Vārds netika pieņemts'}`;
      if (!data.ok) playSound('error');
    } catch {
      result.className = 'word-result bad'; result.textContent = 'Neizdevās sazināties ar vārdu pārbaudi.'; playSound('error');
    }
  }

  function makeChecker(extraClass = '') {
    const section = document.createElement('section');
    section.className = extraClass;
    section.innerHTML = `<div class="section-title">Pārbaudīt vārdu</div><form class="word-check-form"><input data-word-input maxlength="32" autocomplete="off" placeholder="Piemēram, kaķis"><button class="btn" type="submit">Pārbaudīt</button><div class="word-result" data-word-result></div></form><div class="notice">Atļauti parasti Tēzaurā atrodami latviešu vārdi; saīsinājumi un īpašvārdi netiek pieņemti.</div>`;
    const form = section.querySelector('form');
    form.addEventListener('submit', (event) => { event.preventDefault(); checkWord(form); });
    return section;
  }

  const joinCard = document.querySelector('.join-card');
  if (joinCard && !joinCard.querySelector('.word-check')) joinCard.appendChild(makeChecker('word-check'));
  const side = document.querySelector('.side');
  if (side && !side.querySelector('[data-enhanced-word-check]')) {
    const panel = makeChecker('panel card'); panel.dataset.enhancedWordCheck = 'true'; side.appendChild(panel);
  }

  const labels = { TW: '3V', DW: '2V', TL: '3B', DL: '2B' };
  function localizeBoard() {
    document.querySelectorAll('#board .mult').forEach((element) => {
      const value = element.textContent.trim();
      if (labels[value]) element.textContent = labels[value];
    });
  }
  const board = document.getElementById('board');
  if (board) new MutationObserver(localizeBoard).observe(board, { childList: true, subtree: true });
  localizeBoard();
})();
