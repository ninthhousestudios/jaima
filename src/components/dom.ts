/**
 * The two builders every brass piece in the room needs.
 *
 * They live here rather than in altar.ts because the arati lamp is built by
 * its own module and placed by altar.ts — importing them from altar.ts would
 * make that a cycle.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * A flame is two stacked layers — a broad soft glow and a bright core — each
 * flickering on its own period. The periods are deliberately not multiples of
 * one another, so the pair never settles into a visible loop.
 *
 * `index` only has to differ between neighbouring wicks; it is used to push
 * them out of step with each other, not to identify them.
 */
export function flame(host: HTMLElement, scale: number, index: number): HTMLElement {
  const wrap = el('div', 'altar-flame', host);
  wrap.style.setProperty('--flame-scale', String(scale));
  // Prime-ish offsets keep neighbouring wicks out of step with each other.
  wrap.style.setProperty('--flicker-a', `${(1.7 + index * 0.23).toFixed(2)}s`);
  wrap.style.setProperty('--flicker-b', `${(2.3 + index * 0.31).toFixed(2)}s`);
  wrap.style.setProperty('--flicker-delay', `${(index * 0.37).toFixed(2)}s`);
  el('div', 'altar-flame-glow', wrap);
  el('div', 'altar-flame-core', wrap);
  return wrap;
}
