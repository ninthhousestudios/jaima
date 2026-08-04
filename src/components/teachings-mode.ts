const QUOTES = [
  "Love is the only medicine that can heal the wounds of the world.",
  "The beauty of motherhood is not in the sacrifice, but in the love.",
  "Compassion is the ultimate expression of your highest self.",
  "If we have love and compassion in our hearts, our every act will contribute to the wellbeing of humanity.",
  "The sun shines down, and its image reflects in a thousand different pots filled with water. The reflections are many, but they are each reflecting the same sun.",
];

let currentQuote = 0;

export function initTeachingsMode(container: HTMLElement) {
  const el = document.createElement('div');
  el.className = 'teachings-overlay mode-overlay';
  el.id = 'mode-teachings';
  el.innerHTML = `
    <div class="teachings-display">
      <blockquote class="teachings-quote visible">${QUOTES[0]}</blockquote>
      <p class="teachings-attr">— Amma</p>
    </div>
  `;
  container.appendChild(el);

  const quote = el.querySelector('.teachings-quote') as HTMLElement;

  el.addEventListener('click', () => {
    quote.classList.remove('visible');
    setTimeout(() => {
      currentQuote = (currentQuote + 1) % QUOTES.length;
      quote.textContent = QUOTES[currentQuote];
      quote.classList.add('visible');
    }, 500);
  });
}
