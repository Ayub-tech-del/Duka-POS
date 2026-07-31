// Shared page-transition engine, loaded by every page.
// Each page owns its own visual technique via CSS (see the <style> block in each HTML file):
//   - a #pageTransition overlay element for mask-type transitions (curtain, iris), or
//   - the `body` element itself for content-type transitions (fade, slide & scale).
// This file only knows the generic contract: an "enter" animation auto-plays on load,
// and adding the `leaving` class triggers a "leave" animation before navigating.
(function () {
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  window.navigateWithFade = function navigateWithFade(url) {
    if (!url) return;
    const target = document.getElementById('pageTransition') || document.body;
    if (prefersReducedMotion()) {
      window.location.href = url;
      return;
    }
    target.addEventListener('animationend', () => { window.location.href = url; }, { once: true });
    target.classList.add('leaving');
  };

  // Auto-intercept plain internal links (nav buttons, "Open POS till", etc.)
  // so pages don't need per-link wiring — only JS-driven redirects need navigateWithFade() explicitly.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href]');
    if (!link || link.target === '_blank') return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('//') || href.startsWith('mailto:')) return;

    e.preventDefault();
    navigateWithFade(href);
  });
})();
