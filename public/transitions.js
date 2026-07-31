// Shared page-transition helper, loaded by every page (landing, login, pos, dashboard).
// Each page has a #pageCurtain div as the first child of <body> (see transitions.css)
// that swipes off on load and swipes back in before any internal navigation.
(function () {
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  window.navigateWithFade = function navigateWithFade(url) {
    if (!url) return;
    const curtain = document.getElementById('pageCurtain');
    if (!curtain || prefersReducedMotion()) {
      window.location.href = url;
      return;
    }
    curtain.addEventListener('animationend', () => { window.location.href = url; }, { once: true });
    curtain.classList.add('curtain-close');
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
