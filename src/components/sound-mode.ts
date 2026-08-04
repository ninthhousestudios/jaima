export function initSoundMode(container: HTMLElement) {
  const el = document.createElement('div');
  el.className = 'sound-overlay mode-overlay';
  el.id = 'mode-sound';
  el.innerHTML = `
    <div class="sound-display">
      <p class="sound-placeholder">Sound options coming soon</p>
      <div class="sound-tracks">
        <button class="sound-track" disabled>Tanpura</button>
        <button class="sound-track" disabled>Bhajans</button>
        <button class="sound-track" disabled>Ocean</button>
      </div>
    </div>
  `;
  container.appendChild(el);
}
