(() => {
  const socket = window.__burtnieksSocket;
  if (!socket || window.__burtnieksAchievementsReady) return;
  window.__burtnieksAchievementsReady = true;

  const queue = [];
  let active = false;
  let audioContext = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function playAchievementSound() {
    if (localStorage.getItem('burtnieks:sound') === 'off') return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const notes = [523, 659, 784, 1047];
      notes.forEach((frequency, index) => {
        const start = audioContext.currentTime + 0.02 + index * 0.09;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = index === notes.length - 1 ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.055, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.21);
      });
    } catch {}
  }

  function removeActive(overlay) {
    if (!overlay?.isConnected) return;
    overlay.classList.add('achievement-leaving');
    setTimeout(() => {
      overlay.remove();
      active = false;
      showNext();
    }, 260);
  }

  function showNext() {
    if (active || !queue.length) return;
    active = true;
    const effect = queue.shift();
    const items = Array.isArray(effect.items) ? effect.items : [];
    const primary = items[0] || {};
    const playerName = effect.byName || primary.playerName || 'Spēlētājs';
    const letter = String(primary.letter || 'B').slice(0, 1).toUpperCase();

    const overlay = document.createElement('div');
    overlay.className = 'achievement-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <section class="achievement-card">
        <div class="achievement-spark spark-one">✦</div>
        <div class="achievement-spark spark-two">✧</div>
        <div class="achievement-spark spark-three">✦</div>
        <div class="letter-wizard" aria-hidden="true">
          <div class="wizard-hat"><span></span></div>
          <div class="wizard-arm arm-left"></div>
          <div class="wizard-arm arm-right"></div>
          <div class="wizard-tile"><span>${escapeHtml(letter)}</span><i class="wizard-eye eye-left"></i><i class="wizard-eye eye-right"></i><i class="wizard-smile"></i></div>
          <div class="wizard-leg leg-left"></div>
          <div class="wizard-leg leg-right"></div>
        </div>
        <div class="achievement-copy">
          <div class="achievement-kicker">Sasniegums atbloķēts</div>
          <h2>${escapeHtml(playerName)}</h2>
          ${items.length === 1
            ? `<h3>${escapeHtml(primary.title)}</h3><p>${escapeHtml(primary.description)}</p>`
            : `<h3>${items.length} sasniegumi vienā gājienā!</h3><div class="achievement-list">${items.map((item) => `<div><b>${escapeHtml(item.icon)}</b><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></span></div>`).join('')}</div>`}
        </div>
        <button type="button" class="achievement-close" aria-label="Aizvērt sasnieguma paziņojumu">×</button>
      </section>`;

    document.body.appendChild(overlay);
    playAchievementSound();
    const duration = Math.min(7600, 4300 + Math.max(0, items.length - 1) * 700);
    const timer = setTimeout(() => removeActive(overlay), duration);
    overlay.querySelector('.achievement-close')?.addEventListener('click', () => {
      clearTimeout(timer);
      removeActive(overlay);
    });
  }

  socket.on('effect', (effect) => {
    if (effect?.type !== 'achievements' || !Array.isArray(effect.items) || !effect.items.length) return;
    queue.push(effect);
    showNext();
  });
})();