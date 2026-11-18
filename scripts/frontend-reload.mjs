// esbuild reports changed output paths. A CSS-only edit can keep the current DOM.
const replacements = new WeakMap();
let version = Date.now();
new EventSource('/esbuild').addEventListener('change', event => {
  const { added, removed, updated } = JSON.parse(event.data);
  if (!added.length && !removed.length && updated.length === 1 && updated[0].endsWith('.css')) {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const url = new URL(link.href);
      if (url.pathname !== updated[0]) continue;
      replacements.get(link)?.remove();
      const next = link.cloneNode();
      replacements.set(link, next);
      url.searchParams.set('t', ++version);
      next.href = url.href;
      next.onload = () => {
        if (replacements.get(link) !== next) return;
        replacements.delete(link);
        next.onload = next.onerror = null;
        link.remove();
      };
      next.onerror = () => {
        if (replacements.get(link) !== next) return;
        replacements.delete(link);
        next.remove();
      };
      link.after(next);
      return;
    }
  }
  location.reload();
});
