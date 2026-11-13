// UIpocalypse Phase 0 spike S4 — in-page dead-click detection runtime.
// Injected via addInitScript so it wraps fetch/XHR and observes mutations before
// any app code runs. Exposes window.__uip: getActions(), perform(id), events().
(() => {
  if (window.__uip) return;

  const M = { count: 0 };
  const N = { count: 0, log: [] };

  const obs = new MutationObserver((list) => {
    M.count += list.length;
  });
  const startObserving = () => {
    if (!document.documentElement) return false;
    obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    return true;
  };
  if (!startObserving()) {
    // addInitScript can run before <html> exists; retry when the document is parsed.
    document.addEventListener('readystatechange', () => startObserving(), { once: true });
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    N.count++;
    const url = String(args[0] instanceof Request ? args[0].url : args[0]);
    const p = origFetch.apply(this, args);
    p.then((r) => N.log.push({ url, status: r.status })).catch(() => N.log.push({ url, status: 0 }));
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    N.count++;
    const self = this;
    self.addEventListener('load', () => N.log.push({ url: String(url), status: self.status }));
    self.addEventListener('error', () => N.log.push({ url: String(url), status: 0 }));
    return origOpen.apply(this, [method, url]);
  };

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  function isA11yHidden(el) {
    return el.closest('[aria-hidden="true"]') !== null || el.getAttribute('tabindex') === '-1';
  }

  function nameOf(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    if (el.id) {
      const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (l) return (l.textContent || '').trim();
    }
    if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) return el.value || el.type;
    const text = (el.textContent || '').trim();
    if (text) return text;
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.name || el.tagName.toLowerCase();
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'A' && el.getAttribute('href')) return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const t = el.type;
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    return tag.toLowerCase();
  }

  function actionable() {
    const els = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"]')];
    return els.filter((el) => isVisible(el) && !el.disabled && !isA11yHidden(el));
  }

  function ariaState(el) {
    return JSON.stringify({
      expanded: el.getAttribute('aria-expanded'),
      pressed: el.getAttribute('aria-pressed'),
      selected: el.getAttribute('aria-selected'),
      checked: el instanceof HTMLInputElement ? el.checked : null,
    });
  }

  function isTextLike(el) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    return el instanceof HTMLInputElement && ['text', 'email', 'password', 'number', 'search', 'tel', 'url'].includes(el.type);
  }

  window.__uip = {
    getActions() {
      const els = actionable();
      window.__uip.__els = els;
      return els.map((el, id) => ({ id, tag: el.tagName, role: roleOf(el), name: nameOf(el) }));
    },

    async perform(id) {
      const el = window.__uip.__els[id];
      if (!el) return { dead: true, reasons: [], error: 'missing element' };
      // State-saturated controls cannot produce feedback by design (an
      // already-selected radio does nothing when clicked) — not dead, skip.
      if (el instanceof HTMLInputElement && el.type === 'radio' && el.checked) {
        return { dead: false, reasons: ['already-selected'], saturated: true };
      }
      const textLike = isTextLike(el);
      const before = {
        mutations: M.count,
        requests: N.count,
        url: location.href,
        focusOn: document.activeElement === el,
        aria: ariaState(el),
        dialog: !!document.querySelector('dialog[open]'),
      };
      if (textLike) el.focus();
      else el.click();
      await new Promise((r) => setTimeout(r, 500));
      const after = {
        mutations: M.count,
        requests: N.count,
        url: location.href,
        focusOn: document.activeElement === el,
        aria: ariaState(el),
        dialog: !!document.querySelector('dialog[open]'),
      };
      const reasons = [];
      if (after.mutations > before.mutations) reasons.push('mutation');
      if (after.requests > before.requests) reasons.push('request');
      if (after.url !== before.url) reasons.push('nav');
      if (!before.focusOn && after.focusOn) reasons.push('focus');
      if (after.aria !== before.aria) reasons.push('aria');
      if (after.dialog && !before.dialog) reasons.push('dialog');
      return { dead: reasons.length === 0, reasons, nav: after.url !== before.url };
    },

    events() {
      return { mutations: M.count, requests: N.log };
    },
  };
})();
