import { autoUpdate, computePosition, flip, hide, offset, shift, size } from '@floating-ui/dom';

const id = 'atlas-tooltip';
const margin = 12;
let active;
let closeTimer;

export function closeTooltip(anchor) {
  if (!active || (anchor && active.anchor !== anchor)) return;
  clearTimeout(closeTimer);
  active.stop();
  const { element, bubble } = active;
  if (element) {
    const remaining = (element.getAttribute('aria-describedby') || '').split(/\s+/).filter(token => token && token !== id);
    if (remaining.length) element.setAttribute('aria-describedby', remaining.join(' '));
    else element.removeAttribute('aria-describedby');
  }
  bubble.remove();
  active = null;
}

export function showTooltip(anchor, text) {
  clearTimeout(closeTimer);
  if (!text) return closeTooltip();
  if (active?.anchor === anchor) {
    if (active.bubble.textContent !== text) active.bubble.textContent = text;
    return;
  }
  closeTooltip();
  const element = anchor instanceof Element ? anchor : null;
  const bubble = document.createElement('div');
  bubble.className = 'atlas-tooltip';
  bubble.id = id;
  bubble.setAttribute('role', 'tooltip');
  bubble.textContent = text;
  document.body.appendChild(bubble);
  if (element) element.setAttribute('aria-describedby', [element.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));

  const state = { anchor, element, bubble, stop: () => {} };
  active = state;
  let revision = 0;
  const update = async () => {
    if (!(element || anchor.contextElement).isConnected) return closeTooltip(anchor);
    if (element) {
      if (!element.dataset.tooltip) return closeTooltip(anchor);
      if (bubble.textContent !== element.dataset.tooltip) bubble.textContent = element.dataset.tooltip;
    }
    const current = ++revision;
    const { x, y, middlewareData } = await computePosition(anchor, bubble, {
      strategy: 'fixed', placement: 'top',
      middleware: [offset(8), flip({ padding: margin }), shift({ padding: margin }),
        size({ padding: margin, apply({ availableHeight }) {
          bubble.style.maxHeight = Math.max(0, availableHeight) + 'px';
        }}), hide()],
    });
    if (state !== active || current !== revision) return;
    Object.assign(bubble.style, { left: x+'px', top: y+'px', visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible' });
  };
  const stopPosition = autoUpdate(anchor, bubble, update, { animationFrame: true });
  const observer = new MutationObserver(update);
  if (element) observer.observe(element, { attributes: true, attributeFilter: ['data-tooltip'] });
  state.stop = () => { stopPosition(); observer.disconnect(); };
}

export function installTooltips() {
  const trigger = target => target?.closest?.('[data-tooltip]');
  function enter(event) {
    if (active?.bubble.contains(event.target)) { clearTimeout(closeTimer); return; }
    const anchor = trigger(event.target);
    if (anchor) showTooltip(anchor, anchor.dataset.tooltip);
  }
  function leave(event) {
    if (!active?.element) return;
    const { element, bubble } = active;
    if (!element.contains(event.target) && !bubble.contains(event.target)) return;
    if (element.contains(event.relatedTarget) || bubble.contains(event.relatedTarget)) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (active?.element === element && !element.matches(':focus-within') && !element.matches(':hover') && !bubble.matches(':hover')) closeTooltip(element);
    }, 120);
  }
  function press(event) {
    if (trigger(event.target)) enter(event);
    else if (!active?.bubble.contains(event.target)) closeTooltip();
  }
  function key(event) { if (event.key === 'Escape') closeTooltip(); }
  const events = { pointerover: enter, pointerout: leave, focusin: enter, focusout: leave, pointerdown: press, keydown: key };
  for (const [name, handler] of Object.entries(events)) document.addEventListener(name, handler);
  return () => { for (const [name, handler] of Object.entries(events)) document.removeEventListener(name, handler); closeTooltip(); };
}
