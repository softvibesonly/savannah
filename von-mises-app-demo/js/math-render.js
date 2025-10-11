// Lightweight universal math rendering loader for KaTeX.
// Usage in HTML:
//   <script defer src="js/math-render.js" data-katex-base="vendor/katex/"></script>
// - data-katex-base is optional; defaults to trying common paths then CDN.
// - Automatically detects math delimiters and only loads KaTeX when needed.

(function(){
  const WIN = window;
  const DOC = document;

  function hasMathDelimiters(root){
    const t = (root.textContent || '').slice(0, 500000); // cap scan for perf
    return /\\\(|\\\)|\\\[|\\\]|\$\$/.test(t);
  }

  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s = DOC.createElement('script');
      s.src = src;
      s.defer = true;
      s.onload = ()=> resolve();
      s.onerror = ()=> reject(new Error('Failed to load script '+src));
      DOC.head.appendChild(s);
    });
  }

  function loadCSS(href){
    return new Promise((resolve, reject)=>{
      const l = DOC.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = ()=> resolve();
      l.onerror = ()=> reject(new Error('Failed to load CSS '+href));
      DOC.head.appendChild(l);
    });
  }

  function getBaseFromAttr(){
    const tag = DOC.currentScript || DOC.querySelector('script[src*="math-render.js"]');
    if (tag && tag.dataset && tag.dataset.katexBase) {
      let b = tag.dataset.katexBase.trim();
      if (b && !b.endsWith('/')) b += '/';
      return b;
    }
    return null;
  }

  function getScopeEl(){
    const tag = DOC.currentScript || DOC.querySelector('script[src*="math-render.js"]');
    const sel = tag && tag.dataset ? tag.dataset.mathScope : null;
    if (sel) return DOC.querySelector(sel);
    return DOC.body;
  }

  function candidateBases(){
    const fromAttr = getBaseFromAttr();
    const bases = [];
    if (fromAttr) bases.push(fromAttr);
    // Common relative locations
    bases.push('vendor/katex/');
    bases.push('../vendor/katex/');
    bases.push('../../vendor/katex/');
    bases.push('assets/vendor/katex/');
    bases.push('../assets/vendor/katex/');
    return bases;
  }

  async function ensureKaTeX(){
    if (typeof WIN.renderMathInElement === 'function') return true;

    const css = 'katex.min.css';
    const core = 'katex.min.js';
    const auto = 'auto-render.min.js';

    const bases = candidateBases();
    for (const b of bases){
      try {
        await loadCSS(b + css);
        await loadScript(b + core);
        await loadScript(b + auto);
        if (typeof WIN.renderMathInElement === 'function') return true;
      } catch (e) {
        // try next base
      }
    }
    // Fallback to CDN
    try {
      await loadCSS('https://cdn.jsdelivr.net/npm/katex@0.16.7/dist/katex.min.css');
      await loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.7/dist/katex.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.7/dist/contrib/auto-render.min.js');
      return typeof WIN.renderMathInElement === 'function';
    } catch (e) {
      return false;
    }
  }

  function doRender(target){
    if (typeof WIN.renderMathInElement === 'function'){
      try {
        WIN.renderMathInElement(target || DOC.body, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true }
          ]
        });
      } catch(err){
        console.error('KaTeX render error:', err);
      }
    }
  }

  // Expose a helper so app code can call it too
  WIN.renderMathNow = (el)=> doRender(el || getScopeEl() || DOC.body);

  DOC.addEventListener('DOMContentLoaded', async ()=>{
    // If another math engine (e.g., MathJax) is present, do nothing.
    if (WIN.MathJax) return;
    const scope = getScopeEl();
    if (!scope || !hasMathDelimiters(scope)) return; // no math in scope
    const ok = await ensureKaTeX();
    if (ok) doRender(scope);
  });
})();
