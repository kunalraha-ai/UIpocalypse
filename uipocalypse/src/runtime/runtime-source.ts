/**
 * In-page runtime (TRD §3.5), injected via addInitScript. Plain JS kept as a
 * string constant so the bundled CJS CLI has no runtime file reads.
 *
 * Phase 0 S4 learnings baked in:
 * - defer MutationObserver until documentElement exists (addInitScript runs
 *   before it does — eager setup dies silently)
 * - state-saturated controls (already-selected radios) are excluded from
 *   dead-click verdicts
 *
 * Discipline: no backticks inside the runtime source (String.raw host string).
 */

export const RUNTIME_SOURCE = String.raw`
(() => {
  if (window.__uip) return;

  const M = { count: 0 };
  const N = { count: 0, log: [] };
  const E = { pageErrors: [], consoleErrors: [] };
  const SPINNERS = new Map(); // element -> { label: string, since: number }
  const SPINNER_SEL = '[role="progressbar"], [aria-busy="true"], .spinner, .loading';
  const BENIGN_URL = /(favicon|\.map$|\/_next\/static|analytics|sentry)/i;
  const BAD = /delete|unsubscribe|cancel subscription|remove account/i;

  const now = () => Date.now();
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- defensive install
  const obs = new MutationObserver((list) => { M.count += list.length; });
  const startObserving = () => {
    if (!document.documentElement) return false;
    obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    return true;
  };
  if (!startObserving()) {
    document.addEventListener('readystatechange', () => startObserving(), { once: true });
  }

  // ---- network wrap
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      N.count++;
      const url = String(arguments[0] instanceof Request ? arguments[0].url : arguments[0]);
      const p = origFetch.apply(this, arguments);
      p.then(function (r) { N.log.push({ url: url, status: r.status }); })
       .catch(function () { N.log.push({ url: url, status: 0 }); });
      return p;
    };
  }
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    N.count++;
    const self = this;
    self.addEventListener('load', function () { N.log.push({ url: String(url), status: self.status }); });
    self.addEventListener('error', function () { N.log.push({ url: String(url), status: 0 }); });
    return origOpen.apply(this, [method, url]);
  };

  // ---- console + page errors
  const origError = console.error;
  console.error = function () {
    const parts = [];
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i];
      try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
    }
    E.consoleErrors.push(parts.join(' ').slice(0, 500));
    origError.apply(console, arguments);
  };
  window.addEventListener('error', function (e) {
    E.pageErrors.push(String((e && e.message) || 'error').slice(0, 500));
  });
  window.addEventListener('unhandledrejection', function (e) {
    E.pageErrors.push(('unhandledrejection: ' + String(e && e.reason)).slice(0, 500));
  });

  // ---- element helpers
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }
  function isHidden(el) {
    return el.closest('[aria-hidden="true"]') !== null || el.getAttribute('tabindex') === '-1';
  }
  function explicitRole(el) {
    const r = el.getAttribute('role');
    if (r) return r;
    const tag = el.tagName;
    if (tag === 'A' && el.getAttribute('href')) return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') return inputRole(el.type);
    return null;
  }
  function inputRole(t) {
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
    if (t === 'search') return 'searchbox';
    return 'textbox';
  }
  function nameOf(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    if (el.id) {
      const esc = window.CSS && CSS.escape ? CSS.escape(el.id) : el.id;
      const l = document.querySelector('label[for="' + esc + '"]');
      if (l) return (l.textContent || '').trim();
    }
    const wrapper = el.closest ? el.closest('label') : null;
    if (wrapper && wrapper !== el) {
      const text = (wrapper.textContent || '').trim();
      if (text) return text.slice(0, 80);
    }
    if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) return el.value || el.type;
    const text = (el.textContent || '').trim();
    if (text) return text;
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.tagName.toLowerCase();
  }
  const ACTION_SEL = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
  function actionable() {
    const els = document.querySelectorAll(ACTION_SEL);
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!isVisible(el) || isHidden(el) || el.disabled) continue;
      out.push(el);
    }
    return out;
  }
  function isTextLike(el) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    return el instanceof HTMLInputElement &&
      ['text', 'email', 'password', 'number', 'search', 'tel', 'url'].indexOf(el.type) !== -1;
  }
  function isSaturated(el) {
    return el instanceof HTMLInputElement && el.type === 'radio' && el.checked;
  }
  function ariaState(el) {
    return JSON.stringify({
      expanded: el.getAttribute('aria-expanded'),
      pressed: el.getAttribute('aria-pressed'),
      selected: el.getAttribute('aria-selected'),
      checked: el instanceof HTMLInputElement ? el.checked : null,
      value: isTextLike(el) ? el.value.length : null,
    });
  }
  function setValue(el, value) {
    // React-controlled inputs need the native setter + input event
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function snapshotSpinners() {
    const els = document.querySelectorAll(SPINNER_SEL);
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!isVisible(el) || !SPINNERS.has(el)) {
        continue;
      }
    }
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!isVisible(el)) continue;
      if (!SPINNERS.has(el)) {
        SPINNERS.set(el, { label: (el.getAttribute('aria-label') || (el.textContent || '').trim() || 'spinner').slice(0, 80), since: now() });
      }
    }
  }

  let els = [];

  window.__uip = {
    getActions: function () {
      els = actionable();
      const out = [];
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        const name = nameOf(el);
        out.push({
          id: i,
          tag: el.tagName,
          role: explicitRole(el),
          name: String(name).slice(0, 80),
          href: el.getAttribute ? (el.getAttribute('href') || null) : null,
          textLike: isTextLike(el),
          risky: BAD.test(name),
          value: (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? el.value : null,
        });
      }
      snapshotSpinners();
      return out;
    },

    perform: async function (id, opts) {
      opts = opts || {};
      const el = els[id];
      if (!el) return { dead: true, reasons: [], error: 'missing element ' + id };
      if (isSaturated(el)) return { dead: false, reasons: ['already-selected'], saturated: true };
      const textLike = isTextLike(el);

      const before = {
        mutations: M.count,
        requests: N.count,
        url: location.href,
        focusOn: document.activeElement === el,
        aria: ariaState(el),
        dialog: !!document.querySelector('dialog[open]'),
      };

      if (textLike && typeof opts.input === 'string') {
        el.focus();
        setValue(el, opts.input);
      } else if (textLike) {
        el.focus();
      } else {
        el.click();
        if (opts.doubleClick) {
          await delay(opts.interClickDelayMs ?? 40);
          el.click();
        }
      }

      await delay(opts.waitMs ?? 500);

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
      snapshotSpinners();
      return {
        dead: reasons.length === 0,
        reasons: reasons,
        nav: after.url !== before.url,
        url: after.url,
      };
    },

    getState: function () {
      snapshotSpinners();
      return {
        url: location.href,
        title: document.title,
        spinners: Array.from(SPINNERS.values()),
      };
    },

    /** Barrier-synchronized race firing (TRD FR-W4): click element 'id' after
     * 'delayMs' — scheduled inside the page so M contexts fire truly at once. */
    raceFire: function (id, delayMs) {
      const el = els[id];
      if (!el) return { ok: false };
      window.setTimeout(function () { el.click(); }, delayMs);
      return { ok: true };
    },

    drain: function () {
      const out = {
        mutations: M.count,
        requests: N.log.filter(function (r) { return !BENIGN_URL.test(r.url); }),
        pageErrors: E.pageErrors.splice(0),
        consoleErrors: E.consoleErrors.splice(0),
        spinners: Array.from(SPINNERS.entries()).map(function (pair) {
          return { label: pair[1].label, since: pair[1].since, stillVisible: isVisible(pair[0]) };
        }),
      };
      return out;
    },
  };
})();
`;
