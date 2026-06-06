/* ===========================================================
   Kapture — interactivity (vanilla)
   =========================================================== */

/* ---- 1. inject the themed logo glyph into every .logo slot ---- */
(async function injectLogo() {
  try {
    const res = await fetch('assets/logo.svg');
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const src = doc.querySelector('svg');
    const inner = src ? src.querySelector('g') : null;
    const viewBox = src ? src.getAttribute('viewBox') : '0 0 400 407';
    document.querySelectorAll('.logo').forEach((slot) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', viewBox || '0 0 400 407');
      svg.setAttribute('fill', 'none');
      if (inner) svg.innerHTML = inner.outerHTML;
      slot.appendChild(svg);
    });
  } catch (e) { /* logo is decorative */ }
})();

/* ---- 2. lucide icons ---- */
function renderIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } });
  }
}
renderIcons();

/* ---- 3. nav border on scroll ---- */
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

/* ---- 4. reveal on scroll (robust, no IO dependency) ---- */
const MOTION_OK = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

function markIn(el) {
  if (el.classList.contains('in')) return;
  el.classList.add('in');
  el.dataset.inAt = String(performance.now());
}
function revealInView() {
  const h = window.innerHeight;
  document.querySelectorAll('.reveal:not(.in)').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < h * 0.9 && r.bottom > 0) markIn(el);
  });
}
function revealAll() {
  document.documentElement.classList.add('no-anim');
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
}
// Self-healing watchdog: an entrance transition (especially one with a
// transition-delay) can be dropped entirely in throttled / offscreen render
// contexts, stranding content at opacity:0. If an element has been marked
// `.in` long enough that its transition should have finished but it's still
// transparent, snap it to its end-state. This never fires for healthy
// animations (they reach opacity ~1 well before the grace window).
function healStuck() {
  const now = performance.now();
  document.querySelectorAll('.reveal.in').forEach((el) => {
    if (el.dataset.healed) return;
    const since = now - (parseFloat(el.dataset.inAt) || 0);
    if (since > 1200 && parseFloat(getComputedStyle(el).opacity) < 0.95) {
      el.style.transition = 'none';
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.dataset.healed = '1';
    }
  });
}

// Reduced motion / hidden document on first paint: skip animation entirely.
if (!MOTION_OK || document.hidden) {
  revealAll();
} else {
  revealInView();
  requestAnimationFrame(revealInView);
  setInterval(healStuck, 500);
  [1500, 3000].forEach((t) => setTimeout(healStuck, t));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) revealInView(); });
window.addEventListener('scroll', revealInView, { passive: true });
window.addEventListener('load', () => { revealInView(); setTimeout(healStuck, 200); });
window.addEventListener('resize', revealInView, { passive: true });

/* ---- 5. tools tabs ---- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tabpanel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + id));
    // re-trigger reveals inside newly shown panel
    document.querySelectorAll('#panel-' + id + ' .reveal').forEach((el) => el.classList.add('in'));
  });
});

/* ---- 6. tool filter ---- */
const search = document.getElementById('toolSearch');
if (search) {
  const tools = [...document.querySelectorAll('#panel-tools .tool')];
  const groups = [...document.querySelectorAll('#panel-tools .tgroup')];
  const noResults = document.getElementById('noResults');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let any = false;
    tools.forEach((t) => {
      const match = t.textContent.toLowerCase().includes(q);
      t.classList.toggle('hide', !match);
      if (match) any = true;
    });
    groups.forEach((g) => {
      const visible = [...g.querySelectorAll('.tool')].some((t) => !t.classList.contains('hide'));
      g.classList.toggle('hide', !visible);
    });
    if (noResults) noResults.style.display = any ? 'none' : 'block';
  });
}
