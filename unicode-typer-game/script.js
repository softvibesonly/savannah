

(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * AudioManager: handles synthesis of simple tones for feedback.  It
   * uses a single AudioContext to generate sine waves of various
   * frequencies.  You can adjust the volume globally or toggle
   * playback altogether.  For efficiency, oscillators are started and
   * stopped per note; this is sufficient for the short tones
   * required here.  Should the AudioContext be suspended due to
   * browser autoplay policies, the first call to playTone() will
   * resume it.
   */
  const AudioManager = {
    context: null,
    volume: 0.15,
    enabled: true,
    init() {
      if (!this.context) {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
      }
    },
    async ensureUnlocked() {
      // Some browsers suspend the AudioContext until resumed by a
      // user gesture.  Try to resume here.
      if (this.context.state === 'suspended') {
        try {
          await this.context.resume();
        } catch (err) {
          // ignored
        }
      }
    },
    async playTone(frequency, duration = 0.2, volume = this.volume) {
      if (!this.enabled) return;
      this.init();
      await this.ensureUnlocked();
      const ctx = this.context;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.value = volume; // Use the provided volume, or fall back to the global default
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + duration);
    },
    playToneAndWait: async function(frequency, duration = 0.2, volume = this.volume) {
      if (!this.enabled) return;
      this.init();
      await this.ensureUnlocked();

      return new Promise(resolve => {
        const ctx = this.context;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.value = volume;
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        const now = ctx.currentTime;
        osc.start(now);
        osc.stop(now + duration);
        
        // Resolve the promise ONLY after the tone has finished playing
        setTimeout(resolve, duration * 1000);
      });
    },
    _wait: function(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
    async playSuccess() {
      // two pleasant notes separated in time
      await this.playTone(523.25, 0.18); // C5
      await this.playTone(659.25, 0.22); // E5
    },
    async playError() {
      await this.playTone(196.00, 0.4); // G3
    },
    async playKeyPress(index) {
      // ascending notes for keypresses: map index 0..3 to notes
      const freqs = [440.00, 493.88, 554.37, 587.33]; // A4, B4, C#5, D5
      const freq = freqs[Math.min(index, freqs.length - 1)];
      await this.playTone(freq, 0.15);
    }, async playRoundsExtended() {
      // Respect one-shot suppression used by the footer button path
      try {
        if (typeof UnicodeTyper !== 'undefined' && UnicodeTyper._suppressRoundExtensionOnce) {
          UnicodeTyper._suppressRoundExtensionOnce = false; // consume guard
          return; // suppress jingle on button-skip transitions
        }
      } catch (_) { /* ignore */ }
      // Cheerful ascending triad to signal that the schedule extended
      await this.playTone(523.25, 0.12); // C5
      await this.playTone(659.25, 0.12); // E5
      await this.playTone(783.99, 0.18); // G5
    },
    playSymbolSelect() {
      this.playTone(98.00, 0.55, 0.25); // Freq, Duration, Volume
    },
        playStageAdvanceJingle: async function() {
      // The first four notes of "O Canada" (G4, C5, D5, E♭5) with correct rhythm.
      const noteDuration = 0.25;
      const longPause = 200;
      const shortPause = 50;

      await this.playToneAndWait(523.25, noteDuration); // C
      await this._wait(longPause);

      await this.playToneAndWait(622.25, noteDuration); // D#
      await this._wait(shortPause);

      await this.playToneAndWait(622.25, noteDuration); // D#
      await this._wait(shortPause);

      await this.playToneAndWait(415.3, 0.5); // G-wagon#
    },
  };

  /* Utility functions */
  function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function createElement(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') {
        el.className = value;
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value);
      } else {
        el.setAttribute(key, value);
      }
    }
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        el.appendChild(child);
      }
    }
    return el;
  }

  function syncTopBarOffset() {
    const bar = document.getElementById('top-bar');
    if (!bar) return;
    const h = bar.offsetHeight || 64;
    document.documentElement.style.setProperty('--topbar-offset', (h + 12) + 'px');
  }

  function syncFooterOffset() {
    const f = document.getElementById('game-footer');
    if (!f) return;
    const h = f.offsetHeight || 56;
    document.documentElement.style.setProperty('--footer-offset', (h + 12) + 'px');
  }

  // Normalize a URL for case-insensitive, slash-insensitive deduplication
  function normalizeUrl(u) {
    try { return String(u).replace(/\\/g, '/').toLowerCase(); }
    catch (_) { return String(u || ''); }
  }

  /* 
   The main game object encapsulating state and behaviour.  All
   methods reference `this` to access or modify internal state.
   */
  const UnicodeTyper = {
    /* Predefined symbol packs.  Each pack contains up to ten
     characters relevant to the chosen field.  Four‑digit hex
     strings correspond to macOS Unicode input codes. */
    symbolSets: {
      'Basic Greek': [
        { symbol: 'α', name: 'Alpha', code: '03B1' },
        { symbol: 'β', name: 'Beta', code: '03B2' },
        { symbol: 'γ', name: 'Gamma', code: '03B3' },
        { symbol: 'Δ', name: 'Delta (uppercase)', code: '0394' },
        { symbol: 'λ', name: 'Lambda', code: '03BB' },
        { symbol: 'π', name: 'Pi', code: '03C0' },
        { symbol: 'Φ', name: 'Phi (uppercase)', code: '03A6' },
        { symbol: 'σ', name: 'Sigma', code: '03C3' },
        { symbol: 'Ω', name: 'Omega (uppercase)', code: '03A9' },
        { symbol: 'μ', name: 'Mu', code: '03BC' }
        , { symbol: 'Γ', name: 'Gamma (uppercase)', code: '0393' }
        , { symbol: 'Θ', name: 'Theta (uppercase)', code: '0398' }
        , { symbol: 'Λ', name: 'Lambda (uppercase)', code: '039B' }
        , { symbol: 'Σ', name: 'Sigma (uppercase)', code: '03A3' }
        , { symbol: 'Ψ', name: 'Psi (uppercase)', code: '03A8' }
        , { symbol: 'δ', name: 'Delta', code: '03B4' }
        , { symbol: 'θ', name: 'Theta', code: '03B8' }
        , { symbol: 'ψ', name: 'Psi', code: '03C8' }
        , { symbol: 'ω', name: 'Omega', code: '03C9' }
        , { symbol: 'ε', name: 'Epsilon', code: '03B5' }
        , { symbol: 'ϕ', name: 'Phi (loopy)', code: '03D5' }
      ],
      'Advanced Calculus': [
        { symbol: '∫', name: 'Integral', code: '222B' },
        { symbol: '∬', name: 'Double Integral', code: '222C' },
        { symbol: '∭', name: 'Triple Integral', code: '222D' },
        { symbol: '∂', name: 'Partial Differential', code: '2202' },
        { symbol: '∞', name: 'Infinity', code: '221E' },
        { symbol: '∑', name: 'Summation', code: '2211' },
        { symbol: '∏', name: 'Product', code: '220F' },
        { symbol: '√', name: 'Square Root', code: '221A' },
        { symbol: '≈', name: 'Approximately Equal', code: '2248' },
        { symbol: '≤', name: 'Less Or Equal', code: '2264' }
      ],
      Statistics: [
        { symbol: 'μ', name: 'Mu (Mean)', code: '03BC' },
        { symbol: 'σ', name: 'Sigma (Std Dev)', code: '03C3' },
        { symbol: 'ρ', name: 'Rho (Correlation)', code: '03C1' },
        { symbol: 'ν', name: 'Nu', code: '03BD' },
        { symbol: 'τ', name: 'Tau', code: '03C4' },
        { symbol: 'χ', name: 'Chi', code: '03C7' },
        { symbol: 'λ', name: 'Lambda', code: '03BB' },
        { symbol: '±', name: 'Plus Minus', code: '00B1' },
        { symbol: '≠', name: 'Not Equal', code: '2260' },
        // { symbol: '≥', name: 'Greater Or Equal', code: '2265' }
      ]
      , 'Logic & Sets': [
        { symbol: '∈', name: 'Element Of', code: '2208' },
        { symbol: '∃', name: 'There Exists', code: '2203' },
        { symbol: '∀', name: 'For All', code: '2200' },
        { symbol: '⊨', name: 'Entails (semantic consequence)', code: '22A8' }
        , { symbol: 'ℝ', name: 'Real Numbers (double‑struck R)', code: '211D' }
        , { symbol: '∪', name: 'Union', code: '222A' }
        , { symbol: '∩', name: 'Intersection', code: '2229' }
        , { symbol: '‾', name: 'Combining Overline (type after base)', code: '0305' }
      ]
    },
    activeSymbolCodes: new Set(),
    debugDisplayStage: null, 
    currentWorkingSet: [],
    
    // PLAYER STATS (not the same as the game stats the game logic is using) for other stuff
    // This one will just be for like idk we'll figure that out later
    playerStats: {
      streakBest: 0,
    // (Placeholder for future player stats like totalScore, accuracy, etc.)
    },

    symbolProgress: {},
    _showAllSymbolsOverride: false,

    // Stage 2 timer
    _stage2TimerId: null,
    animationsActive: true,

    // Game configuration and state variables.
    // These are reset whenever a new game is started.
    currentPackName: null,
    currentSet: [],
    orderMode: 'random', // 'random' | 'sequential'
    stage1TargetCount: 7, // default desired size for Stage 1 pool (capped by pack size)
    minStage1Size: 3,
    getPackLength(packName) {
      if (packName === '__ALL__') {
        let total = 0; for (const arr of Object.values(this.symbolSets)) total += arr.length; return total;
      }
      const arr = this.symbolSets[packName];
      return Array.isArray(arr) ? arr.length : 0;
    },

    _buildWorkingSetFromActiveCodes() {
      this.currentWorkingSet = [];
      const allSymbols = [].concat(...Object.values(this.symbolSets));
      
      const codesAdded = new Set();

      for (const symbol of allSymbols) {
        // The new rule: Only add a symbol if its code is active AND we haven't already added a symbol with this code.
        if (this.activeSymbolCodes.has(symbol.code) && !codesAdded.has(symbol.code)) {
          this.currentWorkingSet.push(symbol);
          codesAdded.add(symbol.code); 
        }
      }

      // Intelligent sorting based on game mode.
      if (this.orderMode === 'sequential') {
        // In sequential mode, we do NOT sort. The natural iteration order from allSymbols already preserves the intended pack order.
      } else {
        // In random mode, we sort by code to ensure a consistent (but not sequential) order.
        this.currentWorkingSet.sort((a, b) => a.code.localeCompare(b.code));
      }
      
      this.currentSet = this.currentWorkingSet.slice();
    },

    populateStage1SizeOptions(selectEl, packName) {
      if (!selectEl) return;
      const packLen = this.getPackLength(packName);
      if (!packLen) { selectEl.innerHTML = ''; return; }
      
      // Define new rules: a hard minimum of 3, and a default selection of 7
      const MIN_SYMBOLS = this.minStage1Size;
      const defaultSelection = Math.min(7, packLen);
      const maxLen = packLen;
      
      selectEl.innerHTML = '';
      // Build options from the absolute minimum (3) up to the max pack length
      for (let n = MIN_SYMBOLS; n <= maxLen; n++) {
        const labelParts = [String(n)];
    
        if (n === defaultSelection) labelParts[labelParts.length - 1] += ' (default)';
        if (n === maxLen) labelParts[labelParts.length - 1] += ' (max)';
        selectEl.appendChild(createElement('option', { value: String(n) }, [labelParts.join('')]));
      }
      
      // When setting the value, prioritize the actual current number of active symbols.
      // ensures the dropdown always reflects the true state of the game.
      if (this.activeSymbolCodes && this.activeSymbolCodes.size >= MIN_SYMBOLS) {
          selectEl.value = String(this.activeSymbolCodes.size);
      } else {
          // Fall back to localStorage or the default if no game is active.
          let desired = parseInt(localStorage.getItem('stage1TargetCount') || '', 10);
          if (!(Number.isInteger(desired) && desired >= MIN_SYMBOLS && desired <= maxLen)) desired = defaultSelection;
          selectEl.value = String(desired);
      }
    },
    // Stage pointers: 1 (practice/recall), 2 (active recall), 3 (quiz)
    setOrderMode(mode) {
      this.orderMode = (mode === 'sequential') ? 'sequential' : 'random';
      try { localStorage.setItem('orderMode', this.orderMode); } catch (_) {}
    },
    stage: 0,
    // Tracking whether the Alt/Option key is pressed
    isAltDown: false,
    // Debugging UI flag
    debugMode: false,
    // Settings toggle
    showNewSymbolsImmediately: true,
    // Stage1 state
    stage1: null,
    // Stage2 state
    stage2: null,
    // Stage3 state
    stage3: null,
    // Pattern interrupt image pool and no-repeat queue
    interruptPool: [],      // all discovered URLs
    interruptQueue: [],     // shuffled cycle without repeats
    lastInterruptSrc: null, // last image used; avoid back-to-back repeats
    lastInterruptKey: null, // normalized(last) to catch case-variant duplicates
    _packHeightCache: {},

    // Pattern-interrupt skip controller state
    interruptActive: false,
    _interruptTimerId: null,
    _interruptEndTs: 0,
    _finishInterrupt: null,
    _interruptSkipStreak: 0,
    _interruptSkipThisCycle: false,
    _challengeToastTimer: null,
    _suppressRoundExtensionOnce: false,

    /* Ensure the pattern interrupt has a valid visual. If the image fails
       to load (missing path) try a few common fallbacks, and finally
       replace it with a CSS swirl so the UX always works. */
    setupInterruptFallback() {
      const overlay = byId('pattern-interrupt');
      if (!overlay) return;
      const img = overlay.querySelector('#interrupt-image');
      // If there is no <img>, nothing to do (maybe already using CSS swirl). Fallback implemented below.
      if (!img) return;

      // Candidate paths to try if the current src 404s
      const tried = new Set();
      const candidates = [];
      if (img.getAttribute('src')) candidates.push(img.getAttribute('src'));
      // Keep a very small, sane fallback list only
      candidates.push('images/swirl.png');

      function useNextOrFallback() {
        while (candidates.length) {
          const next = candidates.shift();
          if (tried.has(next)) continue;
          tried.add(next);
          img.src = next;
          return; // wait for load/error
        }
        // No viable image sources left: swap to CSS swirl
        const div = createElement('div', { class: 'interrupt-visual', 'aria-hidden': 'true' });
        // Replace the image in place to keep existing CSS/JS behavior
        img.replaceWith(div);
      }

      img.addEventListener('error', () => {
        useNextOrFallback();
      });

      // Only trigger immediate fallback if there is an actual source and it failed to load
      if (img.getAttribute('src') && img.complete && img.naturalWidth === 0) {
        useNextOrFallback();
      }
    },

    /**
     Discover available transition images in /images with names like
     Swirl.png, Swirl1.png, Swirl2.png ... (case-insensitive on the prefix
     'Swirl' vs 'swirl'). Uses fetch(HEAD) probes to avoid console 404s,
     caches results in localStorage, and limits concurrency without capping
     the maximum number of images.
     */
    discoverInterruptImages() {
      // One-shot per page load; prefer a persisted cache to avoid re-probing
      const CACHE_KEY = 'interruptPoolV1';
      if (this.interruptDiscoveryDone && this.interruptPool && this.interruptPool.length) {
        return Promise.resolve(this.interruptPool.slice());
      }
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
        if (Array.isArray(cached) && cached.length) {
          this.interruptPool = cached.slice();
          this.interruptDiscoveryDone = true;
          return Promise.resolve(this.interruptPool);
        }
      } catch (_) { /* ignore */ }

      // Build the candidate list for the images (hard cap at 60, change if desired)
      const urls = [];
      const maxN = 60;
      for (let i = 1; i <= maxN; i++) {
        urls.push(`images/Swirl${i}.png`);
        urls.push(`images/swirl${i}.png`);
      }
      // common base names without a number
      urls.push('images/Swirl.png', 'images/swirl.png');

      // Probe with HEAD requests (caught), avoids console 404 noise
      const found = [];
      const seen = new Set();
      const self = this;

      const concurrency = 8; // polite parallelism; can update to disrespectful parallelism if needed
      let index = 0;

      function normalize(u) { return normalizeUrl(u); }

      async function worker() {
        while (index < urls.length) {
          const myIdx = index++;
          const u = urls[myIdx];
          try {
            const res = await fetch(u, { method: 'HEAD', cache: 'no-cache' });
            if (res && res.ok) {
              const key = normalize(u);
              if (!seen.has(key)) { seen.add(key); found.push(u); }
            }
          } catch (_) {
            // ignore network errors; fetch errors do not spam console when caught
          }
        }
      }

      const workers = Array.from({ length: concurrency }, () => worker());

      return Promise.all(workers).then(() => {
        self.interruptPool = found.length ? found.slice() : ['images/swirl.png'];
        self.interruptDiscoveryDone = true;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(self.interruptPool)); } catch (_) {}
        return self.interruptPool;
      });
    },

    initializeTooltips() {
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.js-tooltip-icon')) {
          const existingTooltips = document.querySelectorAll('.global-tooltip-popup');
          existingTooltips.forEach(tip => tip.remove());
        }
      });

      const triggers = document.querySelectorAll('.js-tooltip-icon');
      triggers.forEach(trigger => {
        let tooltipElement = null;

        trigger.addEventListener('mouseenter', () => {
          tooltipElement = document.createElement('div');
          tooltipElement.className = 'global-tooltip-popup';
          tooltipElement.textContent = trigger.dataset.tooltip.trim();
          document.body.appendChild(tooltipElement);

          const triggerRect = trigger.getBoundingClientRect();
          const tipRect = tooltipElement.getBoundingClientRect();
          const margin = 16;

          let left = triggerRect.left + (triggerRect.width / 2) - (tipRect.width / 2);
          let top = triggerRect.top - tipRect.height - 10;

          if (left < margin) {
            left = margin;
          }
          if (left + tipRect.width > window.innerWidth - margin) {
            left = window.innerWidth - tipRect.width - margin;
          }
          
          tooltipElement.style.left = `${left}px`;
          tooltipElement.style.top = `${top}px`;

          requestAnimationFrame(() => tooltipElement.classList.add('visible'));
        });

        trigger.addEventListener('mouseleave', () => {
          if (tooltipElement) {
            tooltipElement.remove();
            tooltipElement = null;
          }
        });
      });
    },

    /* Initialise the game: populate dropdowns, attach event
       listeners and display the onboarding modal. */
    init() {
      this.initializeTooltips();
      // Populate symbol pack selectors
      const packSelect = byId('pack-select');
      const settingsPackSelect = byId('settings-pack-select');
      for (const packName of Object.keys(this.symbolSets)) {
        const opt = createElement('option', { value: packName }, [packName]);
        const opt2 = createElement('option', { value: packName }, [packName]);
        packSelect.appendChild(opt);
        settingsPackSelect.appendChild(opt2);
      }
      // FUTURE TODO: Add an "All (Hard)" option to the onboarding selector
      const allStartOpt = createElement('option', { value: '__ALL__' }, ['All (Hard)']);
      packSelect.appendChild(allStartOpt);
      // Sync settings dropdown with onboarding
      settingsPackSelect.value = packSelect.value;
      // Add a special "All" option to the settings selector for overview/debugging
      const allOpt = createElement('option', { value: '__ALL__' }, ['All']);
      settingsPackSelect.appendChild(allOpt);

      // Ensure a concrete default pack is selected before we derive sizes
      const packNames = Object.keys(this.symbolSets);
      const fallbackFirst = packNames.length ? packNames[0] : '';
      if (!packSelect.value) packSelect.value = fallbackFirst;
      if (!settingsPackSelect.value) settingsPackSelect.value = packSelect.value;

      // Stage 1 size selectors (onboarding and settings)
      const stage1SizeStart = byId('stage1-size-select');
      const stage1SizeSettings = byId('settings-stage1-size-select');

      // Use the currently selected packs to populate ranges
      const onboardingPack = packSelect.value;
      const settingsPack = settingsPackSelect.value;
      this.populateStage1SizeOptions(stage1SizeStart, onboardingPack);
      this.populateStage1SizeOptions(stage1SizeSettings, settingsPack);
      // When the pack changes (onboarding), refresh size options accordingly
      packSelect.addEventListener('change', (e) => {
        const pn = e.target.value;
        this.populateStage1SizeOptions(stage1SizeStart, pn);
      });
      // When the pack changes (settings), refresh size options accordingly
      settingsPackSelect.addEventListener('change', (e) => {
        const pn = e.target.value === '__ALL__' ? '__ALL__' : e.target.value;
        this.populateStage1SizeOptions(stage1SizeSettings, pn);
      });
      // Persist changes from either size selector and keep them in sync when both are present
      const onSizeChange = (e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isInteger(n)) {
          // 1. Update the target count and save it, just like before.
          this.stage1TargetCount = n;
          try { localStorage.setItem('stage1TargetCount', String(n)); } catch(_) {}
          
          // 2. Re-initialize the active symbols based on the user's choice. This will select 'n' new symbols from the current pack

          this._initializeActiveSymbolsForPack(this.currentPackName);
          
          // 3. Rebuild the live game state with this new set of symbols
          this._buildWorkingSetFromActiveCodes();
          
          // 4. If a game is in progress, update the screen
          if (this.stage > 0) {
            this._rebuildCurrentStageFromActiveSymbols();
          }
          
          // 5. Update the settings menu's visual highlights to match the new selection.
          this._updatePackOverviewStyles();

          // Keep the other dropdown in sync
          if (e.target === stage1SizeStart && stage1SizeSettings) stage1SizeSettings.value = String(n);
          if (e.target === stage1SizeSettings && stage1SizeStart) stage1SizeStart.value = String(n);
          
          this.updateFooter();
        }
      };
      if (stage1SizeStart) stage1SizeStart.addEventListener('change', onSizeChange);
      if (stage1SizeSettings) stage1SizeSettings.addEventListener('change', onSizeChange);
      // Load persisted size into state
      const persistedSize = parseInt(localStorage.getItem('stage1TargetCount') || '', 10);
      if (Number.isInteger(persistedSize)) this.stage1TargetCount = persistedSize;

      // Order selectors (onboarding + settings)
      const startOrderSel = byId('order-select');
      const settingsOrderSel = byId('settings-order-select');
      const storedOrder = (localStorage.getItem('orderMode') === 'sequential') ? 'sequential' : 'random';
      this.orderMode = storedOrder;
      if (startOrderSel) startOrderSel.value = storedOrder;
      if (settingsOrderSel) settingsOrderSel.value = storedOrder;
      if (settingsOrderSel) settingsOrderSel.addEventListener('change', (e) => {
        const val = e.target.value === 'sequential' ? 'sequential' : 'random';
        this.setOrderMode(val);
        if (startOrderSel) startOrderSel.value = val; // keep onboarding in sync if reopened
      });

      // Populate font selector in Settings
      const fontSelect = byId('settings-font-select');
      if (fontSelect) {
        const fontOptions = [
          { value: 'auto',            label: 'Auto (recommended)' },
          { value: 'LatinModernMath', label: 'Latin Modern Math' },
          { value: 'STIXTwoMath',     label: 'STIX Two Math' }
        ];
        for (const opt of fontOptions) {
          fontSelect.appendChild(createElement('option', { value: opt.value }, [opt.label]));
        }
        // Apply saved preference (does not reset the game)
        const stored = localStorage.getItem('mathFontChoice');
        const allowed = new Set(['auto','LatinModernMath','STIXTwoMath']);
        const savedFont = allowed.has(stored) ? stored : 'auto';
        fontSelect.value = savedFont;
        this.applyMathFont(savedFont);
        fontSelect.addEventListener('change', (e) => {
          this.applyMathFont(e.target.value);
        });
      }

      // Onboarding start button
      byId('start-button').addEventListener('click', () => {
        this.currentPackName = packSelect.value;
        AudioManager.enabled = byId('audio-toggle').checked;
        byId('settings-audio-toggle').checked = AudioManager.enabled;
        byId('settings-pack-select').value = this.currentPackName;
        // Apply chosen order from onboarding
        const chosenOrder = (byId('order-select') && byId('order-select').value === 'sequential') ? 'sequential' : 'random';
        this.setOrderMode(chosenOrder);
        // Apply Stage 1 size from onboarding menu before starting game
        const s1sel = byId('stage1-size-select');
        if (s1sel && s1sel.value) {
          const n = parseInt(s1sel.value, 10);
          if (Number.isInteger(n)) {
            this.stage1TargetCount = Math.min(n, this.getPackLength(this.currentPackName === '__ALL__' ? '__ALL__' : this.currentPackName));
            try { localStorage.setItem('stage1TargetCount', String(this.stage1TargetCount)); } catch(_) {}
          }
        }

        // Determine the pool of symbols to select from, handling the special '__ALL__' case.
        let symbolsToChooseFrom;
        if (this.currentPackName === '__ALL__') {
          symbolsToChooseFrom = [].concat(...Object.values(this.symbolSets));
        } else {
          symbolsToChooseFrom = this.symbolSets[this.currentPackName];
        }

        // Select the initial set of active symbols based on order mode and size
        if (this.orderMode === 'sequential') {
          const initialSymbols = symbolsToChooseFrom.slice(0, this.stage1TargetCount);
          this.activeSymbolCodes = new Set(initialSymbols.map(s => s.code));
        } else { // Random mode
          const shuffledSymbols = shuffle(symbolsToChooseFrom).slice(0, this.stage1TargetCount);
          this.activeSymbolCodes = new Set(shuffledSymbols.map(s => s.code));
        }
        this._buildWorkingSetFromActiveCodes();

        this._updatePackOverviewStyles();
        // Start the game
        this.startGame();
      });

      // Settings button on top bar
      byId('settings-button').addEventListener('click', () => {
        this.showSettings();
      });

      // Close settings modal
      byId('close-settings').addEventListener('click', () => {
        this.hideSettings();
      });

      // Changing settings inside settings modal
      byId('settings-pack-select').addEventListener('change', (e) => {
        const newPackToView = e.target.value;
        this.renderPackOverview(newPackToView);
        this._updatePackOverviewStyles();
      });

      byId('settings-audio-toggle').addEventListener('change', (e) => {
        const enabled = e.target.checked;
        AudioManager.enabled = enabled;
        byId('audio-toggle').checked = enabled;
      });

      // Show All Symbols toggle
      const showAllToggle = byId('settings-show-all-toggle');
      if (showAllToggle) {
        showAllToggle.checked = this._showAllSymbolsOverride;
        showAllToggle.addEventListener('change', (e) => {
          this._showAllSymbolsOverride = !!e.target.checked;
          // When the toggle changes, we must rebuild the stage to reflect the choice
          if (this.stage > 0) {
            this._rebuildCurrentStageFromActiveSymbols();
          }
        });
      }
      // Show New Symbols Immediately toggle
      const showNewSymbolsToggle = byId('settings-show-new-symbols-toggle');
      if (showNewSymbolsToggle) {
        const storedShowNew = localStorage.getItem('showNewSymbolsImmediately');
        this.showNewSymbolsImmediately = storedShowNew !== '0'; // Default to true if not '0'
        showNewSymbolsToggle.checked = this.showNewSymbolsImmediately;

        showNewSymbolsToggle.addEventListener('change', (e) => {
          this.showNewSymbolsImmediately = !!e.target.checked;
          try { localStorage.setItem('showNewSymbolsImmediately', this.showNewSymbolsImmediately ? '1' : '0'); } catch (_) {}
        });
      }

      // Debug mode toggle (optional UI)
      const debugToggle = byId('settings-debug-toggle');
      if (debugToggle) {
        const storedDbg = localStorage.getItem('debugMode');
        this.debugMode = storedDbg === '1';
        debugToggle.checked = this.debugMode;
        debugToggle.addEventListener('change', (e) => {
          this.debugMode = !!e.target.checked;
          try { localStorage.setItem('debugMode', this.debugMode ? '1' : '0'); } catch (_) {}
          if (typeof this.updateDebugPanel === 'function') this.updateDebugPanel();
        });
      }

      // Listen to global key events
      document.addEventListener('keydown', (e) => this.handleKeyDown(e));
      document.addEventListener('keyup', (e) => this.handleKeyUp(e));
      window.addEventListener('resize', syncTopBarOffset);
      window.addEventListener('resize', syncFooterOffset);

      // Show onboarding on initial load
      byId('onboarding').classList.remove('hidden');
      this.setupInterruptFallback();
      // Discover available transition images and prime the no-repeat queue
      this.discoverInterruptImages().then((list) => {
        this.interruptPool = list.slice();
        {
          const shuffled = shuffle(list.slice());
          const r = (window.crypto && window.crypto.getRandomValues)
                      ? window.crypto.getRandomValues(new Uint32Array(1))[0]
                      : Math.floor(Math.random() * 0xFFFFFFFF);
          const offset = shuffled.length ? (r % shuffled.length) : 0;
          this.interruptQueue = shuffled.slice(offset).concat(shuffled.slice(0, offset));
        }
      });
      // Prepare the overview table for the default pack (so Settings is ready immediately)
      const initialPack = this.currentPackName || byId('pack-select').value;
      this.renderPackOverview(initialPack === '__ALL__' ? '__ALL__' : initialPack);
      this.attachFooterHandlers();
      this._installExtendEffectsGuardObservers();
      syncFooterOffset();
      this.updateFooter();
      this.updateDebugPanel();
      document.fonts.ready.then(() => {
        this._precalculateAllPackHeights();
      });
    },

    /* Start a new game.  Resets state and begins Stage 1. */
    startGame() {
      // Hide onboarding modal
      byId('onboarding').classList.add('hidden');
      // Hide end-of-game elements if restarting from Stage 3
      byId('game-container').innerHTML = '';
      // Reset stage state
      this.stage = 1;
      this.isAltDown = false;
      this.stage1 = null;
      this.stage2 = null;
      this.stage3 = null;
      // Reset progress display
      byId('progress-display').innerHTML = '';
      // Show top bar and game container
      byId('top-bar').classList.remove('hidden');
      byId('game-container').classList.remove('hidden');
      // Reset the debug panel's view to sync with the current game stage.
      this.debugDisplayStage = null;
      // Move any lingering modals out of view
      this.hideSettings();
      this.hidePatternInterrupt();
      // Build Stage 1 practice with the first three symbols
      this.initStage1();
      syncTopBarOffset();
      syncFooterOffset();
      this.updateFooter();
      this.updateDebugPanel();
    },

    /* Show the settings modal; freeze other interactions while open. */
    showSettings() {
      byId('settings-modal').classList.remove('hidden');
      const sel = byId('settings-pack-select');
      const val = sel && sel.value ? sel.value : this.currentPackName;

      this.renderPackOverview(val === '__ALL__' ? '__ALL__' : this.currentPackName);
      this._updatePackOverviewStyles();

      const fontSel = byId('settings-font-select');
      if (fontSel) {
        const savedFont = localStorage.getItem('mathFontChoice') || 'auto';
        fontSel.value = savedFont;
      }
      const ordSel = byId('settings-order-select');
      if (ordSel) ordSel.value = this.orderMode;
      const s1SizeSel = byId('settings-stage1-size-select');
      if (s1SizeSel) {
        const packForSizes = (val === '__ALL__') ? '__ALL__' : this.currentPackName;
        this.populateStage1SizeOptions(s1SizeSel, packForSizes);
        const persisted = parseInt(localStorage.getItem('stage1TargetCount') || '', 10);
        if (Number.isInteger(persisted)) {
          s1SizeSel.value = String(Math.min(persisted, this.getPackLength(packForSizes)));
        }
      }
    },

    applyMathFont(choice) {
      // Base stack used across the app; put robust fallbacks after the first choice
      const baseStack = `'LatinModernMath', 'Latin Modern Math', 'STIXTwoMath', 'STIX Two Math', 'Cambria Math', 'TeX Gyre Termes Math', 'Asana Math', 'Noto Serif Math', 'Times New Roman', serif`;
      let stack = baseStack;
      if (choice && choice !== 'auto') {
        stack = `'${choice}', ` + baseStack;
      }
      document.documentElement.style.setProperty('--math-font', stack);
      document.documentElement.classList.toggle('font-LatinModernMath', choice === 'LatinModernMath');
      document.documentElement.classList.toggle('font-STIXTwoMath', choice === 'STIXTwoMath');
      try { localStorage.setItem('mathFontChoice', choice || 'auto'); } catch (_) {}
    },
    hideSettings() {
      byId('settings-modal').classList.add('hidden');
      // If the "show immediately" toggle is on, refresh the stage to include any pending symbols.
      if (this.showNewSymbolsImmediately && this.stage === 1 && this.stage1) {
        this._rebuildCurrentStageFromActiveSymbols();
      }
    },

    /* Display the pattern interrupt overlay briefly.  On completion,
       continue with a callback. Now cycles through images and handles fallback.
       Supports swirl-in/out animation via classes randomized per show. */
    showPatternInterrupt(callback) {
      const overlay = byId('pattern-interrupt');
      // Randomize swirl direction each time (for funsies)
      const animClass = Math.random() < 0.5 ? 'swirl-cw' : 'swirl-ccw';
      const img = overlay.querySelector('#interrupt-image');
      // Decide which asset to show this time using a no-repeat queue
      if (!this.interruptQueue || this.interruptQueue.length === 0) {
        const pool = (this.interruptPool && this.interruptPool.length) ? this.interruptPool : ['images/swirl.png'];
        const shuffled = shuffle(pool.slice());
        const r = (window.crypto && window.crypto.getRandomValues)
                    ? window.crypto.getRandomValues(new Uint32Array(1))[0]
                    : Math.floor(Math.random() * 0xFFFFFFFF);
        const offset = shuffled.length ? (r % shuffled.length) : 0;
        this.interruptQueue = shuffled.slice(offset).concat(shuffled.slice(0, offset));
      }
      // Avoid back-to-back repeats (even across case-variant duplicates) when 2+ images exist
      if (this.lastInterruptKey && this.interruptQueue.length > 0 && this.interruptPool.length > 1) {
        let guard = this.interruptQueue.length; // prevent infinite loop
        while (guard-- > 0 && normalizeUrl(this.interruptQueue[0]) === this.lastInterruptKey) {
          this.interruptQueue.push(this.interruptQueue.shift());
        }
      }
      const src = this.interruptQueue.shift();
      this.lastInterruptSrc = src;
      this.lastInterruptKey = normalizeUrl(src);

      // Ensure any previous CSS swirl fallback is removed and an <img> exists
      if (!img) {
        overlay.innerHTML = '';
        const freshImg = createElement('img', { id: 'interrupt-image', alt: 'Abstract swirl' });
        overlay.appendChild(freshImg);
      }
      const picture = overlay.querySelector('#interrupt-image');

      // Reset previous animation classes
      picture.classList.remove('swirl-cw', 'swirl-ccw');

      // If the image fails to load, swap to CSS swirl fallback and apply the same animation class
      const onError = () => {
        const div = createElement('div', { class: 'interrupt-visual', 'aria-hidden': 'true' });
        div.classList.add(animClass);
        picture.replaceWith(div);
      };
      picture.onerror = onError;
      picture.onload = () => { /* allow CSS animation to run normally */ };

      // Set the source just before showing to avoid flashing old image
      picture.src = src;

      // Apply animation class to the image for this show cycle
      picture.classList.add(animClass);

      overlay.classList.remove('hidden');
      AudioManager.playTone(392.00, 0.5); // G4

      // Track active state and allow acceleration via Space/Enter
      this.interruptActive = true;
      this._interruptSkipThisCycle = false;
      const totalMs = 3000;
      const finish = () => {
        overlay.classList.add('hidden');
        const current = overlay.querySelector('#interrupt-image') || overlay.querySelector('.interrupt-visual');
        if (current) current.classList.remove('swirl-cw', 'swirl-ccw');
        this.interruptActive = false;
        document.documentElement.style.removeProperty('--interrupt-duration');

        // Skip streak accounting: count only when user sped up this interrupt
        if (this._interruptSkipThisCycle) {
          this._interruptSkipStreak = (this._interruptSkipStreak || 0) + 1;
        } else {
          this._interruptSkipStreak = 0;
        }
        const triggerChallenge = this._interruptSkipThisCycle && (this._interruptSkipStreak % 3 === 0);
        if (typeof callback === 'function') callback();
        if (triggerChallenge) {
          this.showChallengeToast && this.showChallengeToast();
          setTimeout(() => {
            this.maskOneMoreRowWithFlash && this.maskOneMoreRowWithFlash();
          }, 0);
        }
      };
      this._finishInterrupt = finish;
      this._interruptEndTs = performance.now() + totalMs;
      clearTimeout(this._interruptTimerId);
      this._interruptTimerId = setTimeout(finish, totalMs);
    },
    hidePatternInterrupt() {
      byId('pattern-interrupt').classList.add('hidden');
    },

    handleInterruptSkip() {
      if (!this.interruptActive) return;
      this._interruptSkipThisCycle = true;
      const now = performance.now();
      const remaining = Math.max(0, (this._interruptEndTs || 0) - now);
      // Halve remaining time; don’t go below ~60ms so finish() runs on a new tick
      const newRemaining = Math.max(60, Math.ceil(remaining / 2));
      clearTimeout(this._interruptTimerId);
      this._interruptEndTs = now + newRemaining;
      // Visually accelerate the swirl animation for this cycle
      document.documentElement.style.setProperty('--interrupt-duration', '1.5s');
      const finish = this._finishInterrupt;
      this._interruptTimerId = setTimeout(() => {
        if (typeof finish === 'function') finish();
      }, newRemaining);
    },

    _completeCurrentRoundAsPerfect() {
      if (this.stage !== 1 || !this.stage1) return;
      const st = this.stage1;
      // Make this round look fully satisfied to the quota logic
      if (Array.isArray(st.rowStatus)) {
        st.rowStatus = st.rowStatus.map(() => ({ completed: true }));
      }
      // Reset per-round cursors so the next render starts clean
      st.currentRow = 0;
      st.charIndex = 0;
      st.recallCharIndex = 0;
      st.visibleCharIndex = 0;
    },
    _installDynamicRoundsGuard() {
      if (!this.stage1) return;
      const st = this.stage1;
      if (st.__dynRoundsGuarded) return; // idempotent
      st.__dynRoundsGuarded = true;
      let _val = Number(st.dynamicTotalRounds || 0);
      const owner = this; // capture UnicodeTyper for the setter closure
      try {
        Object.defineProperty(st, 'dynamicTotalRounds', {
          configurable: true,
          enumerable: true,
          get() { return _val; },
          set(newVal) {
            const nv = Number(newVal);
            // If value didn't change, do nothing (avoids false UI triggers)
            if (nv === _val) { _val = nv; return; }

            // One-shot suppression: block only increases once (button-skip case)
            if (owner._suppressRoundExtensionOnce && nv > _val) {
              owner._suppressRoundExtensionOnce = false; // consume guard
              return; // prevent this increase and skip side effects
            }

            const increased = nv > _val;
            _val = nv;

            // On legitimate increases, centralize all side effects here
            if (increased) {
              try { owner.updateFooter && owner.updateFooter(); } catch(_) {}

              // Play the extend jingle (AudioManager already respects the guard as a second line of defense)
              try { AudioManager.playRoundsExtended && AudioManager.playRoundsExtended(); } catch(_) {}

              // Show the (auto-adjust) toast with a reliable animation restart
              try {
                const t = byId('round-extend-toast');
                if (t) {
                  t.classList.remove('hidden');
                  t.classList.remove('show');
                  t.style.display = 'block';
                  t.style.opacity = '0';
                  void t.offsetWidth; // reflow to restart CSS animation
                  requestAnimationFrame(() => {
                    t.classList.add('show');
                    t.style.opacity = '';
                  });
                  setTimeout(() => {
                    t.classList.add('hidden');
                    t.classList.remove('show');
                    t.style.display = '';
                  }, 1250);
                }
              } catch(_) {}

              // Gently bump the round counter color
              try {
                const rc = byId('round-counter');
                if (rc) {
                  rc.classList.add('bump');
                  setTimeout(() => rc.classList.remove('bump'), 1300);
                }
              } catch(_) {}
            }
          }
        });
      } catch (_) {
        // If defineProperty fails (very unlikely), just proceed silently like a ninja
      }
    },

    _installExtendEffectsGuardObservers() {
      // Suppress the extend toast if a guarded transition tries to show it
      const toast = byId('round-extend-toast');
      if (toast && !this._toastObserver) {
        this._toastObserver = new MutationObserver((muts) => {
          if (!this._suppressRoundExtensionOnce) return;
          for (const m of muts) {
            if (m.type === 'attributes' && m.attributeName === 'class') {
              const showing =
                !toast.classList.contains('hidden') ||
                toast.classList.contains('show');
              if (showing) {
                toast.classList.add('hidden');
                toast.classList.remove('show');
                this._suppressRoundExtensionOnce = false; // consume guard
                break;
              }
            }
          }
        });
        this._toastObserver.observe(toast, { attributes: true, attributeFilter: ['class'] });
      }

      // Suppress the round-counter bump animation if present
      const rc = byId('round-counter');
      if (rc && !this._rcObserver) {
        this._rcObserver = new MutationObserver((muts) => {
          if (!this._suppressRoundExtensionOnce) return;
          for (const m of muts) {
            if (m.type === 'attributes' && m.attributeName === 'class') {
              if (rc.classList.contains('bump')) {
                rc.classList.remove('bump');
                this._suppressRoundExtensionOnce = false; // consume guard. like literally. eat that whole thing.
                break;
              }
            }
          }
        });
        this._rcObserver.observe(rc, { attributes: true, attributeFilter: ['class'] });
      }
    },

    showChallengeToast() {
      const el = byId('challenge-toast');
      if (!el) return;
      clearTimeout(this._challengeToastTimer);
      el.classList.remove('hidden');
      el.classList.remove('show');
      el.style.display = 'block';
      el.style.opacity = '0';
      // Restart the CSS animation reliably
      void el.offsetWidth; // reflow
      requestAnimationFrame(() => {
        el.classList.add('show');
        el.style.opacity = '';
      });
      // Auto-hide after animation completes
      this._challengeToastTimer = setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('show');
        el.style.display = '';
      }, 2100);
    },

    maskOneMoreRowWithFlash() {
      // Only applicable in Stage 1 recall; degrade gracefully otherwise
      if (this.stage !== 1 || !this.stage1) return;
      const st = this.stage1;
      const len = Array.isArray(st.indices) ? st.indices.length : 0;
      if (!len) return;
      const alreadyHidden = new Set(st.hiddenPlanned || []);

      // Choose the first eligible row that is not completed and not already hidden
      let targetRow = -1;
      for (let r = 0; r < len; r++) {
        if (st.rowStatus && st.rowStatus[r] && st.rowStatus[r].completed) continue;
        if (alreadyHidden.has(r)) continue;
        targetRow = r; break;
      }
      if (targetRow === -1) return;

      // Flash the DOM row, then convert its code cell to masked (????) with hover reveal
      const tbody = document.querySelector('.symbol-table tbody');
      if (!tbody || !tbody.children[targetRow]) return;
      const tr = tbody.children[targetRow];
      tr.classList.add('flash-mask');

      // After the flash, apply the mask and record it in state
      setTimeout(() => {
        // If the table isn’t mounted yet, try on the next frame as well
        const tbody2 = document.querySelector('.symbol-table tbody');
        if (!tbody2 || !tbody2.children[targetRow]) {
          requestAnimationFrame(() => this.maskOneMoreRowWithFlash());
          return;
        }
        if (!Array.isArray(st.hiddenPlanned)) st.hiddenPlanned = [];
        if (!st.hiddenPlanned.includes(targetRow)) st.hiddenPlanned.push(targetRow);

        const packIdx = st.indices[targetRow];
        const sym = this.currentSet[packIdx];
        const tr2 = tbody2.children[targetRow];
        const tdCode = tr2.querySelector('td.code');
        if (tdCode && sym) {
          tdCode.innerHTML = '';
          const span = createElement('span', {
            class: 'pending',
            dataset: { fullcode: sym.code },
            onmouseover: (e) => { const el = e.currentTarget; if (el.classList.contains('pending')) el.textContent = sym.code; },
            onmouseout: (e) => { const el = e.currentTarget; if (el.classList.contains('pending')) el.textContent = '????'; }
          }, ['????']);
          tdCode.appendChild(span);
        }
        this.updateDebugPanel && this.updateDebugPanel();
      }, 220);
    },

    /* Stage 1 initialization.  Creates the practice table with three shuffled symbols and prepares state variables for input. */
    initStage1() {
      // Create a fresh filing cabinet for the new game.
      this.symbolProgress = {};
      this.currentWorkingSet.forEach(symbol => {
        // For each symbol in the game, create a progress folder.
        this.symbolProgress[symbol.code] = { completed: false };
      });
      
      const allIndicesInWorkSet = Array.from({ length: this.currentWorkingSet.length }, (_, i) => i);
      this.stage1IndicesPool = this.orderMode === 'random' ? shuffle(allIndicesInWorkSet) : allIndicesInWorkSet;

      const initial = this.stage1IndicesPool.slice(0, Math.min(3, this.stage1IndicesPool.length));
      const ordered = shuffle(initial.slice());
      
      this.stage1 = {
        indices: ordered,
        practiceDone: false,
        recallRounds: 0,
        displayRound: 1,
        rowStatus: ordered.map(() => ({ completed: false })),
        practiceRepeatsDone: 0,
        currentRow: 0,
        charIndex: 0,
        step: 'practice',
        hiddenOrder: [],
        hiddenIndex: null,
        recallCharIndex: 0,
        recallHiddenCount: 0,
        seenIndices: new Set(ordered),
        hiddenCounts: Object.fromEntries(ordered.map(i => [this.currentWorkingSet[i].code, 0])), // Use code for key
        stats: {}, // Will be populated below
        visibleRows: [],
        visibleOrder: [],
        visibleIndex: null,
        visibleCharIndex: 0,
        visibleCompletedCount: 0,

        // Graceful error handling: one free mistake for hidden, two for visible per round.
        freeHiddenErrorsUsedThisRound: 0,
        freeVisibleErrorsUsedThisRound: 0,
        
        // round target ensures  we require one completion per row
        roundTargetCount: 0,
        errorFlashTimerId: null,
        _originalIndicesBeforeOverride: null,
        isTransitioning: false

      };

      // Initialize game stats using the permanent symbol code as the key. FYI: previously this used an arbitrary value we defined for each symbol as a unique ID
      this.stage1.stats = {};
      for (const symbol of this.currentWorkingSet) {
        this.stage1.stats[symbol.code] = { alpha: 1, beta: 1, visOK: 0, hidOK: 0, lastHiddenRound: null, maskedFails: 0 };
      }

      const desired = this.currentWorkingSet.length;
      const practiceRounds = desired > 0 ? 2 : 0;
      const recallExpansions = Math.max(0, desired - 3);
      const plannedRepeats = Math.min(recallExpansions, 2);
      this.stage1.dynamicTotalRounds = practiceRounds + recallExpansions + plannedRepeats;

      this._installDynamicRoundsGuard();
      this.renderStage1Table();
      this.updateProgressDisplay();
      syncFooterOffset();
    },

    repeatPracticeRound() {
      // Always reshuffle row positions on repeat
      this.stage1._originalIndicesBeforeOverride = null;
      this.stage1.indices = shuffle(this.stage1.indices.slice());
      this.stage1.rowStatus = this.stage1.indices.map(() => ({ completed: false }));
      this.stage1.currentRow = 0;
      this.stage1.charIndex = 0;
      this.stage1.step = 'practice';
      this.renderStage1Table();
      this.updateProgressDisplay();
      this.updateFooter();
      this.updateDebugPanel();
    },

    /* Render the Stage 1 table based on current indices and state. */
    renderStage1Table() {
      const container = byId('game-container');
      container.innerHTML = '';
      const table = createElement('table', { class: 'symbol-table' });
      const thead = createElement('thead', {}, [
        createElement('tr', {}, [
          createElement('th', {}, ['Symbol']),
          createElement('th', {}, ['Name']),
          createElement('th', {}, ['Unicode Input'])
        ])
      ]);
      table.appendChild(thead);
      const tbody = createElement('tbody');
      this.stage1.indices.forEach((idx, row) => {
        const sym = this.currentSet[idx];
        const rowClasses = [];
        if (row === this.stage1.currentRow) rowClasses.push('highlight');
        if (this.stage1.rowStatus[row]?.completed) rowClasses.push('completed');
        const tr = createElement('tr', { class: rowClasses.join(' ') });
        // Symbol cell
        const tdSymbol = createElement('td', {}, [sym.symbol]);
        // Name cell
        const tdName = createElement('td', {}, [sym.name]);
        // Code cell.  In recall mode the hidden row will show ????
        let codeSpan;
        // Show ???? if the row is in the planned hidden batch and not completed
        const isPlannedHidden = (
          this.stage1.step === 'recall' &&
          Array.isArray(this.stage1.hiddenPlanned) &&
          this.stage1.hiddenPlanned.includes(row) &&
          !(this.stage1.rowStatus[row]?.completed)
        );
        if (isPlannedHidden) {
          codeSpan = createElement('span', {
            class: 'pending',
            dataset: { fullcode: sym.code },
            onmouseover: (e) => {
              const el = e.currentTarget;
              if (el.classList.contains('pending')) {
                el.textContent = sym.code;
              }
            },
            onmouseout: (e) => {
              const el = e.currentTarget;
              if (el.classList.contains('pending') && el.textContent === sym.code) {
                el.textContent = '????';
              }
            }
          }, ['????']);
        } else {
          // For practice and non‑hidden rows we display the full code, subdivided into individual spans for colour feedback.
          const fragments = sym.code.split('').map(ch => {
            return createElement('span', { class: 'pending digit' }, [ch]);
          });
          codeSpan = createElement('span', {}, fragments);
        }
        const tdCode = createElement('td', { class: 'code' });
        tdCode.appendChild(codeSpan);
        tr.appendChild(tdSymbol);
        tr.appendChild(tdName);
        tr.appendChild(tdCode);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
      this.updateFooter();
      container.appendChild(table);
      this.updateFooter();
      this.updateDebugPanel();
    },

    /* Update the per‑symbol progress display.  For Stage 1 the display
       shows which symbol in the list is currently active.  For
       subsequent stages it reflects recall counts. */
    updateProgressDisplay() {
      const disp = byId('progress-display');
      if (this.stage === 1) {
        const list = this.stage1.indices.map((idx, i) => {
          const sym = this.currentSet[idx];
          const completed = this.stage1.rowStatus[i]?.completed;
          return `${completed ? '✓' : ''}${sym.symbol}`;
        }).join('  ');
        disp.innerHTML = `Stage&nbsp;1: Memorize Input Codes<br> <span class="symbols">${list}</span>`;
      } else if (this.stage === 2) {
        let indicesToDisplay = this.stage2.indices;
        // If there are too many symbols, only show the ones not yet mastered.
        if (indicesToDisplay.length > 10) {
          indicesToDisplay = indicesToDisplay.filter(idx => (this.stage2.correctCount[idx] || 0) < 2);
        }        
        const parts = this.stage2.indices.map(idx => {
          const cnt = this.stage2.correctCount[idx] || 0;
          const sym = this.currentSet[idx];
          return `${sym.symbol}:${cnt}/2`;
        });
        const symbolList = parts.join('  ');
        disp.innerHTML = `Stage&nbsp;2: Recall Practice<br> <span class="symbols" style="font-size: 1.1rem;">${symbolList}</span>`;
      } else if (this.stage === 3) {
        disp.textContent = `Stage 3: Recognition quiz  •  Score: ${this.stage3.score}/${this.stage3.round}`;
      } else {
        disp.textContent = '';
      }
      // Recompute top offset when the header content length changes
      syncTopBarOffset();
    },

    /* Handle keydown events globally.  Delegates to the appropriate
       stage handler depending on the current phase. */
    handleKeyDown(e) {
      // Update Option key state
      if (e.key === 'Alt' || e.key === 'AltGraph') {
        if (!this.isAltDown) {
          this.isAltDown = true;
          this.updateOptionIndicator();
        }
      }
      // For any stage, if Alt is down prevent default to avoid OS
      // interfering with code entry (Option+03BB might output λ)
      if (this.isAltDown) {
        e.preventDefault();
      }
      // If the pattern interrupt is visible, allow Space/Enter to speed it up (2x)
      const overlay = byId('pattern-interrupt');
      if (overlay && !overlay.classList.contains('hidden')) {
        const isSkipKey = (
          e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' ||
          e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter'
        );
        if (isSkipKey) {
          e.preventDefault();
          this.handleInterruptSkip();
          return; // don’t forward while interrupt is visible
        }
      }
      // Do not process keys when a modal is open
      if (!byId('settings-modal').classList.contains('hidden')) return;

      // Delegate to current stage handler
      if (this.stage === 1) {
        if (this.stage1.step === 'practice') {
          this.handleStage1PracticeKey(e);
        } else if (this.stage1.step === 'recall') {
          if (this.stage1 && this.stage1.visibleIndex != null) {
            this.handleStage1RecallVisibleKey(e);
          } else {
            this.handleStage1RecallKey(e);
          }
        }
      } else if (this.stage === 2) {
        this.handleStage2Key(e);
      }
      // Stage 3 uses click events; key presses are not used
    },

    /* Handle keyup events to detect when the Option key is released. */
    handleKeyUp(e) {
      if (e.key === 'Alt' || e.key === 'AltGraph') {
        if (this.isAltDown) {
          this.isAltDown = false;
          this.updateOptionIndicator();
          // If currently entering a code in Stage 1, releasing Alt
          // prematurely constitutes an error
          if (this.stage === 1) {
            if (this.stage1.step === 'practice' && this.stage1.charIndex > 0) {
              this.handleStage1Error();
            }
            if (this.stage1.step === 'recall') {
              if (this.stage1 && this.stage1.visibleIndex != null && this.stage1.visibleCharIndex > 0) {
                this.handleStage1RecallVisibleError();
              } else if (this.stage1.recallCharIndex > 0) {
                this.handleStage1RecallError();
              }
            }
          } else if (this.stage === 2 && this.stage2 && this.stage2.typed && this.stage2.typed.length > 0 && this.stage2.typed.length < 4) {
            this.handleStage2Error();
          }
        }
      }
    },

    /* Update the Option key indicator in the top bar based on the
       isAltDown state. */
    updateOptionIndicator() {
      const ind = byId('option-indicator');
      if (this.isAltDown) {
        ind.classList.add('active');
      } else {
        ind.classList.remove('active');
      }
    },

    attachFooterHandlers() {
      const btn = byId('skip-button');
      if (btn) {
        btn.addEventListener('click', () => {
          this.handleSkipToNextRound();
        });
      }
      const dbg = byId('debug-skip-round');
      if (dbg) {
        dbg.addEventListener('click', () => {
          this.debugSkipToNextRound();
        });
      }
    },

    updateFooter() {
      const roundEl = byId('round-counter');
      const expEl = byId('exposure-counter');
      if (!roundEl || !expEl) return;

      let roundText = '';
      let exposureText = '';

      if (this.stage === 1 && this.stage1) {
        const totalSymbolsInPlay = this.currentWorkingSet.length;
        const seen = this.stage1.seenIndices ? this.stage1.seenIndices.size : 0;
        const remaining = Math.max(0, totalSymbolsInPlay - seen);

        // Baseline planned visual rounds under the canonical schedule:
        //   * 2 practice passes
        //   * (totalDesired - 3) recall expansions (each adds one new symbol)
        //   * +1 repeat for the first two recall rounds when present
        // This logic now correctly uses the live "totalSymbolsInPlay"
        const practiceRounds = totalSymbolsInPlay > 0 ? 2 : 0;
        const recallExpansions = Math.max(0, totalSymbolsInPlay - 3);
        const plannedRepeats = Math.min(recallExpansions, 2);
        const baselineTotal = practiceRounds + recallExpansions + plannedRepeats;

        // Current visual round counter (increments after each pattern interrupt)
        const currentRound = Math.max(1, this.stage1.displayRound || 1);
        const dynamicTotal = (this.stage1.dynamicTotalRounds || baselineTotal);
        const totalRounds = Math.max(dynamicTotal, currentRound);

        roundText = `Round: ${currentRound} / ${totalRounds}`;
        exposureText = `Exposed: ${seen} / ${totalSymbolsInPlay}  (${remaining} left)`;
      } else if (this.stage === 2 && this.stage2) {
        // --- STAGE 2 FOOTER LOGIC ---
        // This block is now self-contained and uses state variables specific to Stage 2.
        const completed = this.stage2.roundsCompleted || 0;
        const total = this.stage2.totalRounds || 0;
        const currentRoundForDisplay = Math.min(completed + 1, total);
        roundText = `Round: ${currentRoundForDisplay} / ${total}`;
        exposureText = `Symbols Mastered: ${Math.floor(completed / 2)} / ${total / 2}`;
      }

      roundEl.textContent = roundText;
      expEl.textContent = exposureText;
      this.updateDebugPanel();
    },

    

      /*
    updateDebugPanel() {
      const host = byId('debug-panel');
      if (!host) return;
      host.classList.toggle('hidden', !this.debugMode);
      if (!this.debugMode) { host.innerHTML = ''; return; }

      const stage = this.stage;
      if (stage === 1 && this.stage1) {
        const st = this.stage1;
        const idxs = (st.indices || []).slice();
        const elig = new Set(st.eligibleRows || []);
        const hidden = new Set(st.hiddenPlanned || []);
        const visReq = new Set(st.visibleRequired || []);

        const metaParts = [
          `Step: ${st.step}`,
          `Current Round: ${st.displayRound}`,
          `Recall Rounds: ${st.recallRounds}`,
          `Current Row: ${st.currentRow + 1}`, // Make it start from 1
          `Round Target: ${st.roundTargetCount}`
        ];
        const meta = metaParts.join(' &nbsp;•&nbsp; ');

        let rowsHtml = '<table><thead><tr>' +
          '<th>Row #</th>' +
          '<th>Symbol</th>' +
          '<th>Eligible to<br>Hide</th>' +
          '<th>Hidden</th>' +
          '<th>Visible<br>Required</th>' +
          '<th>Visible<br>OK ✓</th>' +
          '<th>Hidden<br>OK ✓</th>' +
          '<th>&alpha;</th>' +
          '<th>&beta;</th>' +
          '<th>Last<br>Hidden</th>' +
          '</tr></thead><tbody>';

        for (let row = 0; row < idxs.length; row++) {
          const packIdx = idxs[row];
          const sym = this.currentSet[packIdx] || {};
          const stats = (st.stats && st.stats[packIdx]) || {};
          

          const highlightClass = (row === st.currentRow) ? 'class="debug-highlight"' : '';
          const rightAlign = 'style="text-align: right;"';

          rowsHtml += `<tr ${highlightClass}>` +
            `<td>${row + 1}</td>` + // Displaying as 1-based
            `<td>${sym.symbol || '?'}</td>` +
            `<td>${elig.has(row) ? '✓' : ''}</td>` +
            `<td>${hidden.has(row) ? '✓' : ''}</td>` +
            `<td>${visReq.has(row) ? '✓' : ''}</td>` +
            `<td ${rightAlign}>${stats.visOK || 0}</td>` +
            `<td ${rightAlign}>${stats.hidOK || 0}</td>` +
            `<td ${rightAlign}>${stats.alpha || 1}</td>` +
            `<td ${rightAlign}>${stats.beta || 1}</td>` +
            `<td>${stats.lastHiddenRound == null ? '-' : stats.lastHiddenRound}</td>` +
            '</tr>';

        }
        rowsHtml += '</tbody></table>';
        host.innerHTML = `<div class="debug-title">Debug Snapshot — Stage ${stage}</div><div class="muted">${meta}</div>${rowsHtml}`;
      } else {
        host.innerHTML = `<div class="debug-title">Debug Snapshot — Stage ${stage}</div><div class="muted">(No Stage 1 state to display)</div>`;
      }
    },
    */

    _renderStage1Debug(st, stage) {
      const idxs = (st.indices || []).slice();
      const elig = new Set(st.eligibleRows || []);
      const hidden = new Set(st.hiddenPlanned || []);
      const visReq = new Set(st.visibleRequired || []);

      const metaParts = [
        `Step: ${st.step}`,
        `Current Round: ${st.displayRound}`,
        `Recall Rounds: ${st.recallRounds}`,
        `Current Row: ${st.currentRow + 1}`,
        `Round Target: ${st.roundTargetCount}`
      ];
      const meta = metaParts.join(' &nbsp;•&nbsp; ');

      let rowsHtml = '<table><thead><tr>' +
        '<th>Row #</th>' +
        '<th>Symbol</th>' +
        '<th>Eligible to<br>Hide</th>' +
        '<th>Hidden</th>' +
        '<th>Visible<br>Required</th>' +
        '<th>Visible<br>OK ✓</th>' +
        '<th>Hidden<br>OK ✓</th>' +
        '<th>&alpha;</th>' +
        '<th>&beta;</th>' +
        '<th>Last<br>Hidden</th>' +
        '</tr></thead><tbody>';

      for (let row = 0; row < idxs.length; row++) {
        const packIdx = idxs[row];
        const sym = this.currentSet[packIdx] || {};
        const stats = (st.stats && sym.code && st.stats[sym.code]) || {};

        const highlightClass = (row === st.currentRow) ? 'class="debug-highlight"' : '';
        const rightAlign = 'style="text-align: right;"';

        rowsHtml += `<tr ${highlightClass}>` +
          `<td>${row + 1}</td>` +
          `<td>${sym.symbol || '?'}</td>` +
          `<td>${elig.has(row) ? '✓' : ''}</td>` +
          `<td>${hidden.has(row) ? '✓' : ''}</td>` +
          `<td>${visReq.has(row) ? '✓' : ''}</td>` +
          `<td ${rightAlign}>${stats.visOK || 0}</td>` +
          `<td ${rightAlign}>${stats.hidOK || 0}</td>` +
          `<td ${rightAlign}>${stats.alpha || 1}</td>` +
          `<td ${rightAlign}>${stats.beta || 1}</td>` +
          `<td>${stats.lastHiddenRound == null ? '-' : stats.lastHiddenRound}</td>` +
          '</tr>';
      }
      rowsHtml += '</tbody></table>';

      return `<div class="muted">${meta}</div>${rowsHtml}`;

      // return `<div class="debug-title">Debug Snapshot — Stage ${stage}</div><div class="muted">${meta}</div>${rowsHtml}`;
    },

    _renderStage2Debug(st, stage) {
      const totalSymbols = st.indices ? st.indices.length : 0;
      const targetRecalls = totalSymbols * 2;
      const currentRecalls = st.correctCount ? Object.values(st.correctCount).reduce((sum, count) => sum + count, 0) : 0;
      const masteredCount = st.correctCount ? Object.values(st.correctCount).filter(count => count >= 2).length : 0;
      const queueLength = st.queue ? st.queue.length : 0;

      const meta = [
        `Mastered: ${masteredCount}/${totalSymbols}`,
        `Total Correct: ${currentRecalls}/${targetRecalls}`,
        `Queue Left: ${queueLength}`
      ].join(' &nbsp;•&nbsp; ');

      const indices = st.indices || [];

      let rowsHtml = '<table><thead><tr>' +
                     '<th>#</th><th>Symbol</th><th>Name</th><th>Code</th><th>Recall Count</th>' +
                     '</tr></thead><tbody>';

      for (let i = 0; i < indices.length; i++) {
        const packIdx = indices[i];
        const sym = (this.currentSet && this.currentSet[packIdx]) || {};
        const correctCount = (st.correctCount && st.correctCount[packIdx]) || 0;
        const highlightClass = (packIdx === st.currentIdx) ? 'class="debug-highlight"' : '';
        rowsHtml += `<tr ${highlightClass}><td>${i + 1}</td><td>${sym.symbol || '?'}</td><td>${sym.name || '?'}</td><td>${sym.code || '????'}</td><td>${correctCount}/2</td></tr>`;
      }
      rowsHtml += '</tbody></table>';

      return `<div class="muted">${meta}</div>${rowsHtml}`;

      // return `<div class="debug-title">Debug Snapshot — Stage ${stage}</div><div class="muted">${meta}</div>${rowsHtml}`;
    },

    updateDebugPanel() {
      const host = byId('debug-panel');
      if (!host) return;

      host.classList.toggle('hidden', !this.debugMode);
      if (!this.debugMode) {
        host.innerHTML = '';
        return;
      }
      
      // If the display stage isn't set, default it to the current game stage.
      if (this.debugDisplayStage === null) {
        this.debugDisplayStage = this.stage;
      }
      
      const stageToRender = this.debugDisplayStage;

      let contentHtml = '';
      if (stageToRender === 1 && this.stage1) {
        contentHtml = this._renderStage1Debug(this.stage1, stageToRender);
      } else if (stageToRender === 2 && this.stage2) {
        contentHtml = this._renderStage2Debug(this.stage2, stageToRender);
      } else {
        contentHtml = `<div class="muted">(No Stage ${stageToRender} state to display) Either the game hasn't started or you found a meta-bug within the debug snapshot lol</div>`;
      }

      // Build Title with Navigation
      const isLeftDisabled = stageToRender <= 1;
      const isRightDisabled = stageToRender >= 3;

      const buttonStyle = `style="background:none; border:none; cursor:pointer; font-size: 1.2rem; vertical-align: middle; padding: 0 0.5rem;"`;
      const disabledStyle = `style="opacity: 0.2; cursor: default;"`;

      const leftArrow = `<button id="debug-prev" ${buttonStyle} ${isLeftDisabled ? disabledStyle : ''}>⬅️</button>`;
      const rightArrow = `<button id="debug-next" ${buttonStyle} ${isRightDisabled ? disabledStyle : ''}>➡️</button>`;
      
      const titleHtml = `<div class="debug-title">${leftArrow} Debug Snapshot — Stage ${stageToRender} ${rightArrow}</div>`;

      host.innerHTML = titleHtml + contentHtml;

      // Attach Event Listeners
      if (!isLeftDisabled) {
        const prevBtn = byId('debug-prev');
        if (prevBtn) prevBtn.onclick = () => {
          this.debugDisplayStage--;
          this.updateDebugPanel();
        };
      }

      if (!isRightDisabled) {
        const nextBtn = byId('debug-next');
        if (nextBtn) nextBtn.onclick = () => {
          this.debugDisplayStage++;
          this.updateDebugPanel();
        };
      }
    },


    // You know I half vibe coded this part and half used my textbook and then I forgot to add comments so now I literally don't remember what any of this part does
    getPackIndexFromRow(row) {
      if (!this.stage1 || !Array.isArray(this.stage1.indices)) return null;
      const r = Number(row);
      if (!Number.isInteger(r) || r < 0 || r >= this.stage1.indices.length) return null;
      return this.stage1.indices[r];
    },

    updateStats(packIdx, { visibleSuccess = false, hiddenSuccess = false, hiddenFailure = false } = {}) {
      if (packIdx == null) return;
      const symbolCode = this.currentWorkingSet[packIdx]?.code;
      if (!symbolCode) return;
      const st = (this.stage1.stats[symbolCode] ||= { alpha:1, beta:1, visOK:0, hidOK:0, lastHiddenRound:null });
      if (visibleSuccess) st.visOK = (st.visOK || 0) + 1;
      if (hiddenSuccess) {
        st.alpha = (st.alpha || 1) + 1;
        st.hidOK  = (st.hidOK  || 0) + 1;
        st.lastHiddenRound = this.stage1.displayRound || 1;
      }
      if (hiddenFailure) {
        st.beta  = (st.beta  || 1) + 1;
      }
    },

    handleSkipToNextRound() {
      // Treat this as a perfect round and block any extension for this transition
      this._suppressRoundExtensionOnce = true;
      this._interruptSkipStreak = 0;
      this._interruptSkipThisCycle = false;
      this._completeCurrentRoundAsPerfect();

      // Only meaningful during Stage 1
      if (this.stage !== 1 || !this.stage1) return;

      /* Old code from before. Don't delete 
      
      Determine which symbols the user has been exposed to
      let seenIdx = [];
      if (this.stage1.seenIndices && this.stage1.seenIndices.size) {
        seenIdx = Array.from(this.stage1.seenIndices);
      } else if (Array.isArray(this.stage1.indices)) {
        seenIdx = this.stage1.indices.slice();
      }
      if (!seenIdx.length) return;

      // Restrict the working set to ONLY those symbols
      const newSet = seenIdx.map(i => this.currentSet[i]).filter(Boolean);
      this.currentSet = newSet;

      // Keep later stages in sync with the reduced set
      this.stage1TargetCount = newSet.length;
      try { localStorage.setItem('stage1TargetCount', String(this.stage1TargetCount)); } catch(_) {}

      // Rebuild a simple indices pool [0..k)
      this.stage1IndicesPool = Array.from({ length: newSet.length }, (_, i) => i);

      */

      // Jump to Stage 2
      this.startStage2();

      // Refresh footer
      this.updateFooter();
    },

    extendStage1TotalRounds(delta = 1) {
      if (this.stage !== 1 || !this.stage1) return;
      const prev = this.stage1.dynamicTotalRounds || 0;
      const next = Math.max(prev + (Number.isFinite(delta) ? delta : 1), prev + 1);
      this.stage1.dynamicTotalRounds = next;
      this.updateFooter();
    },

    debugSkipToNextRound() {
      // Developer tool: forcibly advance to the next *visual* round in Stage 1
      if (this.stage !== 1 || !this.stage1) return;

      if (this.stage1.step === 'practice') {
        // Skip any remaining practice and jump into the first recall round
        this.stage1.practiceDone = true;
        this.stage1.step = 'recall';
        this.stage1.recallRounds = 0;
        this.showPatternInterrupt(() => {
          this.stage1.displayRound = (this.stage1.displayRound || 1) + 1;
          this.startStage1RecallRound();
          this.updateFooter();
        });
        return;
      }

      if (this.stage1.step === 'recall') {
        // Mark all planned hidden rows and required visible confirmations as completed
        const planned = this.stage1.hiddenPlanned || [];
        const visReq  = this.stage1.visibleRequired || [];
        planned.forEach(rowIdx => {
            const packIdx = this.getPackIndexFromRow(rowIdx);
            if (packIdx !== null) this.updateStats(packIdx, { hiddenSuccess: true });
        });
        visReq.forEach(rowIdx => {
            const packIdx = this.getPackIndexFromRow(rowIdx);
            if (packIdx !== null) this.updateStats(packIdx, { visibleSuccess: true });
        });
        this.stage1.hiddenOrder = planned.slice();
        this.stage1.recallHiddenCount = planned.length;
        this.stage1.visibleOrder = visReq.slice();
        this.stage1.visibleCompletedCount = visReq.length;
        // Clear any in-progress row state
        this.stage1.hiddenIndex = null;
        this.stage1.visibleIndex = null;
        this.stage1.recallCharIndex = 0;
        this.stage1.visibleCharIndex = 0;
        // Ensure UI considers all rows complete
        if (Array.isArray(this.stage1.rowStatus)) {
          for (let i = 0; i < this.stage1.rowStatus.length; i++) {
            this.stage1.rowStatus[i] = { completed: true };
          }
        }
        // Trigger end-of-round logic (repeat once then advance)
        this._suppressRoundExtensionOnce = true;
        this.startNewHiddenRow();
        this.updateFooter();
      }
    },

    /* Stage 1 practice handler: verify each digit/letter typed while
       holding Alt matches the current symbol’s code. */
    handleStage1PracticeKey(e) {
      if (this.stage1 && this.stage1.isTransitioning) return;

      // DEBUG: This tells us a key was pressed and which key the game thinks it is.
      // The timestamp helps us see if there are long delays.
      console.log(`[${Date.now()}] Practice Key Event: key='${e.key}', code='${e.code}'`);

      if (!this.isAltDown) return; /* We only care about input when Alt is held
         Ignore modifier keys such as Alt, Shift, Control etc.  Only
         process actual hexadecimal digits.  Without this guard the
         initial press of the Option key would be treated as an
         incorrect character. */
      if (['Alt', 'AltGraph', 'Shift', 'Control', 'Meta', 'Tab'].includes(e.key)) {
        return;
      }
      /* Determine the character based on the physical key code.  When
      // Option is held on macOS, event.key may contain a different
      // Unicode character (e.g., Option+3 -> '£').  Using
      // event.code ensures it maps the physical digit/letter keys to
         their intended hexadecimal values. Probably. Idk if this works. */
      let typedChar = null;
      if (/^Digit[0-9]$/.test(e.code)) {
        typedChar = e.code.slice(5);
      } else if (/^Key[A-F]$/.test(e.code)) {
        typedChar = e.code.slice(3);
      }
      if (!typedChar) {
        // Not a valid hexadecimal key; treat as error
        this.handleStage1Error();
        return;
      }
      typedChar = typedChar.toUpperCase();
      const rowIdx = this.stage1.currentRow;
      const symbolIndex = this.stage1.indices[rowIdx];
      const code = this.currentSet[symbolIndex].code.toUpperCase();
      const expectedChar = code[this.stage1.charIndex];
      const table = byId('game-container').querySelector('table');
      const row = table.rows[rowIdx + 1]; // +1 to skip header row
      const codeCell = row.querySelector('td.code');
      const spans = codeCell.querySelectorAll('span.digit');
        if (typedChar === expectedChar) {
          // Correct character
          spans[this.stage1.charIndex].classList.remove('pending');
          spans[this.stage1.charIndex].classList.add('correct');
          this.stage1.charIndex++;
          AudioManager.playKeyPress(this.stage1.charIndex - 1);
          if (this.stage1.charIndex === 4) {
            // DEBUG: This log confirms the 4-digit code was correct.
            console.log(`[${Date.now()}] Practice Success: Code complete.`)
            // We reached the 4th character. Let the browser paint the final green state before we grey out / rerender the row.
            if (this.stage1.isTransitioning) return;
            this.stage1.isTransitioning = true;
            AudioManager.playSuccess();
            const rowIdxFrozen = rowIdx;
            setTimeout(() => {
              this.stage1.isTransitioning = false;
              // DEBUG: This log confirms the timeout fired and we are moving to the next state.
              console.log(`[${Date.now()}] Practice Success Timeout Fired. Moving to next state.`);
              clearTimeout(this.stage1.errorFlashTimerId);
              // Mark complete and reset counters after a short paint delay
              this.stage1.rowStatus[rowIdxFrozen].completed = true;

              // Update the permanent record in the "filing cabinet"
              const completedSymbol = this.currentWorkingSet[symbolIndex];
              if (completedSymbol) {
                  this.symbolProgress[completedSymbol.code].completed = true;
              }

              this.stage1.charIndex = 0;
              // Count a visible success for practice completion
              const packIdx = this.getPackIndexFromRow(rowIdxFrozen);
              this.updateStats(packIdx, { visibleSuccess: true });
            // Flash row green
            row.style.animation = 'flashGreen 0.6s';
            setTimeout(() => { row.style.animation = ''; }, 600);
            // Move to next row or finish
            if (rowIdxFrozen + 1 < this.stage1.indices.length) {
              this.stage1.currentRow++;
              this.updateProgressDisplay();
              this.renderStage1Table();
            } else {
              // Finished a full pass of practice (3 symbols)
              if ((this.stage1.practiceRepeatsDone || 0) < 1) {
                // Repeat the same practice round once more, with rows reshuffled
                this.stage1.practiceRepeatsDone = (this.stage1.practiceRepeatsDone || 0) + 1;
                this.showPatternInterrupt(() => {
                  this.stage1.displayRound = (this.stage1.displayRound || 1) + 1;
                  this.repeatPracticeRound();
                  this.updateFooter();
                });
              } else {
                // After two passes, proceed to recall of 4 symbols
                this.stage1.practiceDone = true;
                this.stage1.step = 'recall';
                this.stage1.recallRounds = 0;
                this.showPatternInterrupt(() => {
                  this.stage1.displayRound = (this.stage1.displayRound || 1) + 1;
                  this.startStage1RecallRound();
                  this.updateFooter();
                });
              }
            }
          }, 120); // small delay so the 4th digit visibly turns green
        }
      } else {
        // Error: wrong character
        this.handleStage1Error();
      }
    },

    /* Handle an error during Stage 1 practice: play sound and reset
       the current row’s code state. */
    handleStage1Error() {
        console.log(`[${Date.now()}] Practice Error Triggered. Resetting input for current row.`);
      AudioManager.playError();
      // Flash the row red
      const table = byId('game-container').querySelector('table');
      const row = table.rows[this.stage1.currentRow + 1];
      row.style.animation = 'flashRed 0.6s';
      clearTimeout(this.stage1.errorFlashTimerId);
      this.stage1.errorFlashTimerId = setTimeout(() => { row.style.animation = ''; }, 600);
      // Reset character index and code cell colours
      const codeCell = row.querySelector('td.code');
      const spans = codeCell.querySelectorAll('span.digit');
      spans.forEach(span => {
        span.classList.remove('correct');
        span.classList.add('pending');
      });
      this.stage1.charIndex = 0;
    },

    /* Start a recall round with an incrementally larger set of
       symbols.  Called after practice and after each recall round. */
    startStage1RecallRound() {
      this.stage1._originalIndicesBeforeOverride = null;
      // Determine how many rounds we’ve completed so far.  0 -> 4
      // symbols; 1 -> 5 symbols; after that we proceed to Stage 2.
      const round = this.stage1.recallRounds;
      // Track symbols seen in previous rounds so we only hide those
      const prevSeen = new Set(this.stage1.seenIndices || []);
      const targetCount = Math.min(4 + round, this.stage1IndicesPool.length);
      // Build indices: shuffle previous round’s indices and append
      // next new one if exists
      let base = this.stage1.indices.slice();
      // Always reshuffle row positions each round, regardless of order mode
      base = shuffle(base);
      if (targetCount > base.length) {
        // Append the next unused index
        base.push(this.stage1IndicesPool[base.length]);
      }
      this.stage1.indices = base;

      // FIX: If the "Show All" override is active, expand the current view to include all symbols in the pool, not just the ones for this round.
      if (this._showAllSymbolsOverride) {
        this.stage1.indices = this.stage1IndicesPool.slice();
      }

      // Track which indices are newly introduced this round (not in prevSeen)
      this.stage1.newlyIntroducedIndices = base.filter(i => !prevSeen.has(i));
      this.stage1.hasNewSymbolThisRound = this.stage1.newlyIntroducedIndices.length > 0;
      // Ensure hiddenCounts has entries for all indices shown this round
      if (!this.stage1.hiddenCounts) this.stage1.hiddenCounts = {};
      for (const i of base) {
        if (this.stage1.hiddenCounts[i] == null) this.stage1.hiddenCounts[i] = 0;
      }
      // Ensure stats objects exist for all indices in this round
      this.stage1.stats = this.stage1.stats || {};
      for (const i of base) {
        if (!this.stage1.stats[i]) {
          this.stage1.stats[i] = { alpha: 1, beta: 1, visOK: 0, hidOK: 0, lastHiddenRound: null };
        }
      }
      // Determine which rows are eligible to be hidden this round: only ones seen before
      this.stage1.eligibleRows = [];
      for (let i = 0; i < base.length; i++) {
        if (prevSeen.has(base[i])) this.stage1.eligibleRows.push(i);
      }
      // Plan a batch of simultaneously hidden rows for this round.
      const eligibleCount = this.stage1.eligibleRows.length;
      const displayRound = Math.max(1, this.stage1.displayRound || 1);
      // Start at 1 hidden on the first recall (round 3), then +1 hidden every two display rounds: 3–4 -> 1, 5–6 -> 2, 7–8 -> 3, ...
      const offsetFromFirstRecall = Math.max(0, displayRound - 3);
      const plannedBatchSize = Math.min(Math.floor(offsetFromFirstRecall / 2) + 1, eligibleCount);
      const mode = 'weak'; // or 'adversarial' if you add a toggle
      this.stage1.hiddenPlanned = this.selectHiddenBatch(this.stage1.eligibleRows, plannedBatchSize, mode);

      // Rows that must be confirmed visibly this round are all rows NOT in the hidden batch.
      // This guarantees one completion per row.
      const hiddenSet = new Set(this.stage1.hiddenPlanned || []);
      this.stage1.visibleRequired = base.map((_, i) => i).filter(i => !hiddenSet.has(i));
      // Update cumulative seen set to include everything shown this round
      this.stage1.seenIndices = new Set([...prevSeen, ...base]);
      // Round bookkeeping: we must complete one task per row (hidden task for eligible rows,
      // visible-typing task for newly introduced rows)
      this.stage1.visibleOrder = [];
      this.stage1.visibleCompletedCount = 0;
      this.stage1.visibleIndex = null;
      this.stage1.visibleCharIndex = 0;
      this.stage1.roundTargetCount = base.length;
      // Reset recall tracking
      this.stage1.hiddenOrder = [];
      this.stage1.recallHiddenCount = 0;
      this.stage1.hiddenIndex = null;
      this.stage1.recallCharIndex = 0;
      // Tracking repeats for first two recall rounds
      this.stage1.repeatPass = 1;
      // Keep a copy of which indices are newly introduced this round for repeat logic
      this.stage1.newlyIntroducedIndices = this.stage1.newlyIntroducedIndices || [];
      this.stage1.step = 'recall';
      this.stage1.rowStatus = base.map(() => ({ completed: false }));
      // Render table and hide the first hidden row
      // Reset free error counters for the new round
      this.stage1.freeHiddenErrorsUsedThisRound = 0;
      this.stage1.freeVisibleErrorsUsedThisRound = 0;

      this.renderStage1Table();
      this.updateProgressDisplay();
      // Kick off recall by hiding one row
      this.startNewHiddenRow();
      this.updateFooter();
      this.updateDebugPanel();
    },

    repeatCurrentRecallRound() {
      // A repeat adds one more visual round beyond the baseline
      this.extendStage1TotalRounds(1);

      // Re-run the current recall round with same symbol set, reshuffled every time
      const base = this.stage1.indices.slice();
      this.stage1.indices = shuffle(base);
      // Eligible are the ones seen before this round; newly introduced stay visible
      const newSet = new Set(this.stage1.newlyIntroducedIndices || []);
      this.stage1.eligibleRows = [];
      for (let i = 0; i < this.stage1.indices.length; i++) {
        const idx = this.stage1.indices[i];
        if (!newSet.has(idx)) this.stage1.eligibleRows.push(i);
      }
      // Plan a batch of simultaneously hidden rows for this round.
      const eligibleCount = this.stage1.eligibleRows.length;
      const displayRound = Math.max(1, this.stage1.displayRound || 1);
      // Start at 1 hidden on the first recall (round 3), then +1 hidden every two display rounds: 3–4 -> 1, 5–6 -> 2, 7–8 -> 3, ...
      const offsetFromFirstRecall = Math.max(0, displayRound - 3);
      const plannedBatchSize = Math.min(Math.floor(offsetFromFirstRecall / 2) + 1, eligibleCount);
      const mode = 'weak';
      this.stage1.hiddenPlanned = this.selectHiddenBatch(this.stage1.eligibleRows, plannedBatchSize, mode);
      // Rebuild the visible-required list for this repeat pass
      this.stage1.visibleRequired = this.stage1.indices.map((_, i) => i).filter(i => !this.stage1.hiddenPlanned.includes(i));
      this.stage1.visibleOrder = [];
      this.stage1.visibleCompletedCount = 0;
      this.stage1.visibleIndex = null;
      this.stage1.visibleCharIndex = 0;
      this.stage1.roundTargetCount = this.stage1.indices.length;
      this.stage1.rowStatus = this.stage1.indices.map(() => ({ completed: false }));
      this.stage1.currentRow = 0;
      this.stage1.recallCharIndex = 0;
      this.stage1.hiddenOrder = [];
      this.stage1.recallHiddenCount = 0;
      this.stage1.hiddenIndex = null;
      this.stage1.step = 'recall';
      // Ensure repeatPass is initialized on repeat
      // Reset free error counters for the repeat round
      this.stage1.freeHiddenErrorsUsedThisRound = 0;
      this.stage1.freeVisibleErrorsUsedThisRound = 0;

      this.stage1.repeatPass = this.stage1.repeatPass || 1;
      this.renderStage1Table();
      this.updateProgressDisplay();
      this.startNewHiddenRow();
      this.updateFooter();
    },

    // Choose a new row to hide in recall mode.  Once all rows have been hidden exactly once, the recall round ends
    startNewHiddenRow() {
      // Use the planned set of hidden rows for this round
      const planned = this.stage1.hiddenPlanned || [];
      const remaining = planned.filter(i => !this.stage1.hiddenOrder.includes(i) && !this.stage1.rowStatus[i]?.completed);

      // If all planned hidden rows are complete, finish visible confirmations or advance
      if (remaining.length === 0) {
        const pendingVisible = (this.stage1.visibleRequired || []).filter(i => !this.stage1.visibleOrder.includes(i) && !this.stage1.rowStatus[i]?.completed);
        if (pendingVisible.length > 0) {
          const nextVisible = pendingVisible[Math.floor(Math.random() * pendingVisible.length)];

          // If the chosen row is already completed, just retry. Trust me this actually works better than an actual fix lmao its more robust
          if (this.stage1.rowStatus[nextVisible]?.completed) {
            this.startNewHiddenRow();
            return;
          }

          this.startVisibleRecallOnRow(nextVisible);
          return;
        }
        // Repeat each recall round once to give the newest symbol a hidden attempt before advancing
        if ((this.stage1.repeatPass || 1) < 2) {
          this.stage1.repeatPass = (this.stage1.repeatPass || 1) + 1;
          this.showPatternInterrupt(() => { this.stage1.displayRound = (this.stage1.displayRound || 1) + 1; this.repeatCurrentRecallRound(); this.updateFooter(); });
          return;
        }
        // Otherwise advance to next recall round or Stage 2
        this.stage1.recallRounds++;
        const pool = this.stage1IndicesPool;
        // Quota rule: Symbols with >= 2 masked fails need 2 hidden successes. Otherwise, they need 1.
        const everyoneReady = pool.every(i => {
          const symbolCode = this.currentWorkingSet[i]?.code;
          if (!symbolCode) return false;
          const st = (this.stage1.stats && this.stage1.stats[symbolCode]) || { hidOK: 0, maskedFails: 0 };
          
          if ((st.maskedFails || 0) >= 2) {
            // Remedial Path: This symbol is difficult, so require 2 hidden successes
            return (st.hidOK || 0) >= 2;
          } else {
            // Standard Path: This symbol is not a problem, so require only 1 hidden success
            return (st.hidOK || 0) >= 1;
          }
        });
        if (everyoneReady) {
          this.startStage2();
        } else {
          this.showPatternInterrupt(() => {
            this.stage1.displayRound = (this.stage1.displayRound || 1) + 1;
            this.startStage1RecallRound();
            this.updateFooter();
          });
        }
        return;
      }

      // Choose the next active hidden row from the remaining planned set
      const next = remaining[Math.floor(Math.random() * remaining.length)];

      // If the chosen row is already completed, just retry.
      if (this.stage1.rowStatus[next]?.completed) {
        this.startNewHiddenRow();
        return;
      }

      this.stage1.hiddenIndex = next;
      this.stage1.visibleIndex = null; 
      this.stage1.currentRow = next;
      this.stage1.recallCharIndex = 0;

      // Replace its code with ???? and set up hint handlers
      const table = byId('game-container').querySelector('table');
      const row = table.rows[next + 1];
      const codeCell = row.querySelector('td.code');
      const fullcode = this.currentSet[this.stage1.indices[next]].code;
      codeCell.textContent = '';
      const span = createElement('span', {
        class: 'pending',
        dataset: { fullcode },
        onmouseenter: (e) => { const el = e.currentTarget; if (el.classList.contains('pending')) el.textContent = fullcode; },
        onmouseleave: (e) => { const el = e.currentTarget; if (el.classList.contains('pending') && el.textContent === fullcode) el.textContent = '????'; }
      }, ['????']);
      codeCell.appendChild(span);

      // Highlight only this active row (others in planned set remain visually hidden)
      Array.from(table.tBodies[0].rows).forEach((tr, i) => {
        tr.classList.toggle('highlight', i === next);
      });
      this.updateFooter();
    },

    startVisibleRecallOnRow(rowIdx) {
      this.stage1.visibleIndex = rowIdx;
      this.stage1.hiddenIndex = null; 
      this.stage1.visibleCharIndex = 0;
      const table = byId('game-container').querySelector('table');
      const row = table.rows[rowIdx + 1];
      const codeCell = row.querySelector('td.code');
      const spans = codeCell.querySelectorAll('span.digit');
      // Reset digit visuals to pending for a fresh visible entry
      spans.forEach(span => {
        span.classList.remove('correct');
        span.classList.add('pending');
      });
      // Highlight this row exclusively
      Array.from(table.tBodies[0].rows).forEach((tr, i) => {
        tr.classList.toggle('highlight', i === rowIdx);
      });
    },

    /* Handle key events during Stage 1 recall.  The user must type
       the hidden code from memory. */
    handleStage1RecallKey(e) {
      if (this.stage1 && this.stage1.isTransitioning) return;
      // DEBUG:
      console.log(`[${Date.now()}] Recall Key Event: key='${e.key}', code='${e.code}'`);

      if (!this.isAltDown) return;
      // Ignore modifier keys
      if (['Alt', 'AltGraph', 'Shift', 'Control', 'Meta', 'Tab'].includes(e.key)) {
        return;
      }
      // Determine typed character from physical key
      let typedChar = null;
      if (/^Digit[0-9]$/.test(e.code)) {
        typedChar = e.code.slice(5);
      } else if (/^Key[A-F]$/.test(e.code)) {
        typedChar = e.code.slice(3);
      }
      if (!typedChar) {
        this.handleStage1RecallError();
        return;
      }
      typedChar = typedChar.toUpperCase();
      const hiddenRow = this.stage1.hiddenIndex;
      if (hiddenRow == null) return;
      const symbolIndex = this.stage1.indices[hiddenRow];
      const code = this.currentSet[symbolIndex].code.toUpperCase();
      const expectedChar = code[this.stage1.recallCharIndex];
      const table = byId('game-container').querySelector('table');
      const row = table.rows[hiddenRow + 1];
      const codeCell = row.querySelector('td.code');
      const span = codeCell.querySelector('span');
      let currentDisplay = span.textContent;
      if (typedChar === expectedChar) {
        // Replace one question mark with the correct character
        currentDisplay = currentDisplay.split('');
        currentDisplay[this.stage1.recallCharIndex] = expectedChar;
        span.textContent = currentDisplay.join('');
        span.classList.remove('pending');
        span.classList.add('correct');
        this.stage1.recallCharIndex++;
        AudioManager.playKeyPress(this.stage1.recallCharIndex - 1);
        if (this.stage1.recallCharIndex === 4) {
          console.log(`[${Date.now()}] Recall Success: Code complete.`);
          if (this.stage1.isTransitioning) return;
          this.stage1.isTransitioning = true;
          this.stage1.recallCharIndex = 0; // reset immediately to avoid Alt keyup error
          // Completed this hidden row
          AudioManager.playSuccess();
          this.stage1.hiddenOrder.push(hiddenRow);
          this.stage1.recallHiddenCount++;
          // Track that this symbol has been successfully recalled (hidden) once
          this.stage1.hiddenCounts[symbolIndex] = (this.stage1.hiddenCounts[symbolIndex] || 0) + 1;
          this.stage1.rowStatus[hiddenRow] = { completed: true };
          row.classList.add('completed');
          // Reveal the full code (ensures styling) and mark as complete
          span.textContent = code;
          span.classList.remove('pending');
          span.classList.add('correct');
          row.classList.remove('highlight');
          row.style.animation = 'flashGreen 0.6s';
          clearTimeout(this.stage1.errorFlashTimerId);
          setTimeout(() => {
            // DEBUG: This log confirms the timeout fired and we are starting a new hidden row.
            console.log(`[${Date.now()}] Recall Success Timeout Fired. Starting new hidden row.`); 
            row.style.animation = ''; }, 600);
          // (Optional but safe) Ensure the footer updates as soon as a hidden row completes.
          this.updateFooter();
          // Hidden success -> update Beta posterior and counters
          {
            // This is the new, correct code
            const packIdx = this.getPackIndexFromRow(hiddenRow);
            this.updateStats(packIdx, { hiddenSuccess: true });
            this.updateDebugPanel();
          }
          // Move to next hidden row after a short pause
          setTimeout(() => {
            this.stage1.isTransitioning = false;
            this.startNewHiddenRow();
          }, 600);
        }
      } else {
        this.handleStage1RecallError();
      }
    },

    handleStage1RecallVisibleKey(e) {
      if (this.stage1 && this.stage1.isTransitioning) return;
      if (!this.isAltDown) return;
      if (["Alt", "AltGraph", "Shift", "Control", "Meta", "Tab"].includes(e.key)) return;
      let typedChar = null;
      if (/^Digit[0-9]$/.test(e.code)) typedChar = e.code.slice(5);
      else if (/^Key[A-F]$/.test(e.code)) typedChar = e.code.slice(3);
      if (!typedChar) { this.handleStage1RecallVisibleError(); return; }
      typedChar = typedChar.toUpperCase();

      const rowIdx = this.stage1.visibleIndex;
      if (rowIdx == null) return;
      const symbolIndex = this.stage1.indices[rowIdx];
      const code = this.currentSet[symbolIndex].code.toUpperCase();
      const expectedChar = code[this.stage1.visibleCharIndex];
      const table = byId('game-container').querySelector('table');
      const row = table.rows[rowIdx + 1];
      const codeCell = row.querySelector('td.code');
      const spans = codeCell.querySelectorAll('span.digit');

      if (typedChar === expectedChar) {
        spans[this.stage1.visibleCharIndex].classList.remove('pending');
        spans[this.stage1.visibleCharIndex].classList.add('correct');
        this.stage1.visibleCharIndex++;
        AudioManager.playKeyPress(this.stage1.visibleCharIndex - 1);
        if (this.stage1.visibleCharIndex === 4) {
          if (this.stage1.isTransitioning) return;
          this.stage1.isTransitioning = true;
          this.updateFooter();
          AudioManager.playSuccess();
          this.stage1.visibleOrder.push(rowIdx);
          this.stage1.visibleCompletedCount++;
          this.stage1.rowStatus[rowIdx] = { completed: true }
          // Count a visible success for visible recall completion
          {
            const symIdx = this.stage1.indices[this.stage1.visibleIndex];
            const st = (this.stage1.stats[symIdx] ||= { alpha:1, beta:1, visOK:0, hidOK:0, lastHiddenRound:null });
            st.visOK = (st.visOK || 0) + 1;
          }
          row.classList.add('completed');
          row.style.animation = 'flashGreen 0.6s';
          setTimeout(() => { row.style.animation = ''; }, 600);
          // reset visible input state
          this.stage1.visibleIndex = null;
          this.stage1.visibleCharIndex = 0;
          // proceed to next task (hidden or remaining visible)
          this.updateFooter();
          setTimeout(() => { 
            this.stage1.isTransitioning = false;
            this.startNewHiddenRow(); 
          }, 600);
        }
      } else {
        this.handleStage1RecallVisibleError();
      }
    },

    handleStage1RecallVisibleError() {
      AudioManager.playError();

      // Check if a "free error" is available for visible symbols this round.
      if (this.stage1.freeVisibleErrorsUsedThisRound < 2) {
        this.stage1.freeVisibleErrorsUsedThisRound++;
        // This was a free error. We still reset the input but do NOT update stats.
      } else {
        // No free errors left. This counts as a real mistake.
        // (Currently, there's no stat update for visible errors, but this is where it would go)
      }
    this.updateDebugPanel();

      const rowIdx = this.stage1.visibleIndex;
      if (rowIdx == null) return;
      const table = byId('game-container').querySelector('table');
      const row = table.rows[rowIdx + 1];
      row.style.animation = 'flashRed 0.6s';
      this.stage1.errorFlashTimerId = setTimeout(() => { row.style.animation = ''; }, 600);
      const codeCell = row.querySelector('td.code');
      const spans = codeCell.querySelectorAll('span.digit');
      spans.forEach(span => { span.classList.remove('correct'); span.classList.add('pending'); });
      this.stage1.visibleCharIndex = 0;
    },

    /* Handle errors during Stage 1 recall.  Reset the hidden row’s
       code display and restart entry. */
    handleStage1RecallError() {
      console.log(`[${Date.now()}] Recall Error Triggered. Resetting input for masked row.`);
      AudioManager.playError();

      // Check if the one "free error" for hidden symbols has been used this round.
      if (this.stage1.freeHiddenErrorsUsedThisRound < 1) {
        this.stage1.freeHiddenErrorsUsedThisRound++;
        // This was a free error. We do NOT update the stats.
      } else {
        // No free errors left. This is a real mistake.
        // Hidden failure -> update Beta posterior and recency
        const symIdx = this.stage1.indices[
          this.stage1.hiddenIndex != null ? this.stage1.hiddenIndex : this.stage1.currentRow
        ];
        const symbolCode = this.currentWorkingSet[symIdx]?.code;
        if (symbolCode) {
          const st = (this.stage1.stats[symbolCode] ||= { alpha:1, beta:1, visOK:0, hidOK:0, lastHiddenRound:null });
          st.beta = (st.beta || 1) + 1;
          st.lastHiddenRound = this.stage1.displayRound || 1;
          st.maskedFails = (st.maskedFails || 0) + 1;
        }
        this.updateDebugPanel();
      }

      const hiddenRow = this.stage1.hiddenIndex;
      if (hiddenRow == null) return;
      const table = byId('game-container').querySelector('table');
      const row = table.rows[hiddenRow + 1];
      row.style.animation = 'flashRed 0.6s';
      clearTimeout(this.stage1.errorFlashTimerId);
      this.stage1.errorFlashTimerId = setTimeout(() => { row.style.animation = ''; }, 600);
      const codeCell = row.querySelector('td.code');
      const span = codeCell.querySelector('span');
      // Reset to four question marks
      const fullcode = this.currentSet[this.stage1.indices[hiddenRow]].code;
      span.textContent = '????';
      span.dataset.fullcode = fullcode;
      span.classList.remove('correct');
      span.classList.add('pending');
      this.stage1.recallCharIndex = 0;
    },


    // This is the _rebuildStage1() function just ummm you know slightly different

    _rebuildCurrentStageFromActiveSymbols() {
      if (this.stage !== 1 || !this.stage1) return;
      const st = this.stage1;

      // Establish a consistent "before" and "after" state.
      const oldWorkingSet = this.currentWorkingSet.slice();
      const oldIndices = (st.indices || []).slice();

      // Update the world to its new state.
      this._buildWorkingSetFromActiveCodes();
      this.stage1IndicesPool = Array.from({ length: this.currentWorkingSet.length }, (_, i) => i);
      if (this.orderMode === 'random') {
        this.stage1IndicesPool = shuffle(this.stage1IndicesPool);
      }

      // Capture the snapshot of what was on screen, using the saved old state.
      const codesOnScreen = new Set(oldIndices.map(i => oldWorkingSet[i]?.code).filter(Boolean));

      // STATE RECONCILIATION LOGIC 
      if (!st.practiceDone) {
        // PATH 1: Practice is not done. Full reset is required.
        this.initStage1();
        return;
      }

      // This is the new, more robust check. A soft reset is needed if the set of symbols on screen is not identical to the new set of active symbols.
      const newSymbolSet = this.activeSymbolCodes;
      const needsSoftReset = (codesOnScreen.size !== newSymbolSet.size) || ![...codesOnScreen].every(code => newSymbolSet.has(code));

      if (this._showAllSymbolsOverride) {
        if (st._originalIndicesBeforeOverride === null) st._originalIndicesBeforeOverride = st.indices.slice();
        st.indices = this.stage1IndicesPool.slice();
      } else {
        if (st._originalIndicesBeforeOverride !== null) {
          st.indices = st._originalIndicesBeforeOverride;
          st._originalIndicesBeforeOverride = null;
        } else if (needsSoftReset) {
          // FIX: Correctly reconcile the symbols for the current round.
          const finalCodesForRound = new Set(oldIndices.map(i => oldWorkingSet[i]?.code).filter(Boolean));
          const oldActiveCodes = new Set(oldWorkingSet.map(s => s.code));
          for (const code of this.activeSymbolCodes) {
            if (!oldActiveCodes.has(code)) finalCodesForRound.add(code);
          }
          for (const code of oldActiveCodes) {
            if (!this.activeSymbolCodes.has(code)) finalCodesForRound.delete(code);
          }

          const symbolsToShow = this.currentWorkingSet.filter(symbol => finalCodesForRound.has(symbol.code));
          const newIndicesForRound = symbolsToShow.map(symbol => this.currentWorkingSet.indexOf(symbol));
          st.indices = newIndicesForRound;
        }
      }

      // Final render for paths 2, 3, and the cases where no soft reset was needed.
      this.renderStage1Table();
      this,updateProgressDisplay();
      this.updateFooter();
      this.updateDebugPanel();
    },

    
    
    _rebuildStage2() {
      // 1. Capture Current Context and Update Symbol Set
      const currentSymbolCode = this.stage2.currentIdx !== null ? 
      this.currentSet[this.stage2.currentIdx]?.code : null;
      this._buildWorkingSetFromActiveCodes();

      // 2. Rebuild Stage 2 State from the master progress tracker
      const newIndices = Array.from({ length: this.currentSet.length }, (_, i) => i);
      const newCorrectCount = {};
      let newRoundsCompleted = 0;

      newIndices.forEach(newIndex => {
        const symbol = this.currentSet[newIndex];
        // Ensure a tracker exists for newly added symbols
        if (!this.stage2Progress[symbol.code]) {
          this.stage2Progress[symbol.code] = { recalls: 0 };
        }
        const savedProgress = this.stage2Progress[symbol.code].recalls;
        newCorrectCount[newIndex] = savedProgress;
        newRoundsCompleted += savedProgress;
      });

      this.stage2.indices = newIndices;
      this.stage2.correctCount = newCorrectCount;
      this.stage2.roundsCompleted = newRoundsCompleted;
      this.stage2.totalRounds = newIndices.length * 2;
      this.stage2.queue = (this.orderMode === 'random') ? shuffle(newIndices.slice()) : newIndices.slice();

      // 3. Reconcile the view (ROBUSTLY)
      const newCurrentIndex = this.currentSet.findIndex(s => s.code === currentSymbolCode);

      if (newCurrentIndex !== -1) {
        // The current symbol still exists. Keep it on screen.
        this.stage2.currentIdx = newCurrentIndex;
        byId('stage2-symbol').textContent = this.currentSet[newCurrentIndex].symbol;
        byId('stage2-hint').innerHTML = `⌥ + <span id="stage2-code-span">${this.stage2.typed + '????'.slice(this.stage2.typed.length)}</span>`;
      } else {
        // The current symbol was removed. Start a fresh trial.
        // This is the key fix for the freeze.
        this.stage2.typed = ''; 
        this.startStage2Trial();
      }

      this.updateProgressDisplay();
      this.updateFooter();
      this.updateDebugPanel();
    },

    // Choose which rows to hide this round using a lightweight Bayesian + guard approach
    selectHiddenBatch(eligibleRows, plannedK, mode /* 'weak' | 'adversarial' */) {
      const r = this.stage1.displayRound || 1;
      const VMIN = 2;      // require at least 2 visible successes before hiding
      const LAMBDA = 0.4;  // uncertainty weight (encourage exploration)
      const RHO = 0.1;     // hidden-recency weight
      const RMAX = 4;      // linear recency cap in rounds

      const recencyOf = (st) => {
        if (!st || st.lastHiddenRound == null) return 1; // never hidden -> full nudge
        const gap = Math.max(0, r - st.lastHiddenRound);
        return Math.min(1, gap / RMAX);
      };

      // Deterministic score via Beta posterior mean (can also swap to Thompson sampling)
      const thetaMean = (a, b) => a / (a + b);

      const scored = [];
      for (const row of eligibleRows) {
        const symIdx = this.stage1.indices[row];
        const symbol = this.currentWorkingSet[symIdx];
        if (!symbol) continue; // Safety check
        const st = (this.stage1.stats && this.stage1.stats[symbol.code]) || { alpha:1, beta:1, visOK:0, hidOK:0, lastHiddenRound:null };
        if ((st.visOK || 0) < VMIN) continue; // not eligible to hide yet
        const a = Math.max(1, st.alpha || 1), b = Math.max(1, st.beta || 1);
        const theta = thetaMean(a, b);
        const uncert = 1 / (a + b);
        const rec = recencyOf(st);
        const base = (mode === 'adversarial') ? +theta : -theta; // weak: prioritize lower theta
        const score = base + LAMBDA * uncert + RHO * rec;
        scored.push({ row, score });
      }
      // Sort by the adaptive score
      scored.sort((x, y) => y.score - x.score);
      const chosen = scored.slice(0, plannedK).map(s => s.row);

      /* Difficulty floor backfill
         If adaptive selection yielded fewer than plannedK (e.g., because no item met VMIN),
         backfill from remaining eligible rows **ignoring VMIN** but still avoiding brand-new items
         (eligibleRows already excludes newly introduced symbols for this round). */
      if (chosen.length < plannedK) {
        const missing = plannedK - chosen.length;
        const chosenSet = new Set(chosen);
        const rest = eligibleRows.filter(r => !chosenSet.has(r));

        // Rank fallbacks by: (1) fewer historical hidden successes, (2) older lastHiddenRound,
        // tie-break randomly to avoid determinism
        const hc = this.stage1.hiddenCounts || {};
        const restRanked = rest.slice().sort((a, b) => {
          const ia = this.stage1.indices[a], ib = this.stage1.indices[b];
          const ha = hc[ia] || 0, hb = hc[ib] || 0;
          if (ha !== hb) return ha - hb;
          const sa = (this.stage1.stats && this.stage1.stats[ia]) || {};
          const sb = (this.stage1.stats && this.stage1.stats[ib]) || {};
          const ra = sa.lastHiddenRound == null ? -Infinity : sa.lastHiddenRound;
          const rb = sb.lastHiddenRound == null ? -Infinity : sb.lastHiddenRound;
          if (ra !== rb) return ra - rb; // older (or never) first
          return Math.random() - 0.5;
        });

        for (const r of restRanked) {
          if (chosen.length >= plannedK) break;
          chosen.push(r);
        }
      }

      return chosen;
    },

    /* Initialise Stage 2 using the Stage 1 symbols mastered. */
    startStage2() {
      this.stage = 2;
      AudioManager.playStageAdvanceJingle();
      this.currentSet = this.currentWorkingSet.slice();
      // This guarantees Stage 2 ALWAYS starts with the full, correct set
      const indices = Array.from({ length: this.currentSet.length }, (_, i) => i);

      
      // Initialize the master progress tracker for Stage 2
      this.stage2Progress = {};
      this.currentSet.forEach(symbol => {
        this.stage2Progress[symbol.code] = { recalls: 0 };
      });

      // The local correctCount now reads from the master tracker
      const correctCount = {};
      indices.forEach(idx => {
        const code = this.currentSet[idx].code;
        correctCount[idx] = this.stage2Progress[code].recalls;
      });


      this.stage2 = {
        indices: indices,
        correctCount: correctCount,
        queue: (this.orderMode === 'random') ? shuffle(indices.slice()) : indices.slice(),
        currentIdx: null,
        typed: '',
        hintLevel: 0,
        successCounter: 0,
        showFrequency: 1,
        errorFlashTimerId: null,
        lastDisplacedSymbolCode: null,
        // New properties for timer and streaks
        stage2TimerDuration: 5000, // in milliseconds
        streakForTimer: 0,
        isTransitioning: false,
        stage2WaitingForFirstKey: true
      };
      this.stage2.totalRounds = this.stage2.indices.length * 2;
      this.stage2.roundsCompleted = 0;
      this.renderStage2(); // Render the UI
      this.updateProgressDisplay();
      this.updateFooter();
      this.startStage2Trial();
      this.updateDebugPanel();
    },

    startStage2Trial() {
      // byId('stage2-hint').style.color = '';
      const hintEl = byId('stage2-hint');
      if (hintEl) hintEl.style.color = '';
      clearTimeout(this.stage2.errorFlashTimerId);
      if (this.stage2.queue.length === 0) {
        this.stage2.queue = (this.orderMode === 'random') ? shuffle(this.stage2.indices.slice()) : this.stage2.indices.slice();
      }
      const idx = this.stage2.queue.shift();
      this.stage2.currentIdx = idx;
      this.stage2.typed = '';
      this.stage2.hintLevel = 0;
      this.stage2.errorFlashTimerId = null; 
      const symbol = this.currentSet[idx];
      const code = symbol.code.toUpperCase(); // Get code for the hint
      
      byId('stage2-symbol').textContent = symbol.symbol;
      
      // Use innerHTML to create an interactive span for the initial hint
      hintEl.innerHTML = `⌥ + <span id="stage2-code-span">????</span>`;
      
      // Find the new span and attach hover events
      const codeSpan = byId('stage2-code-span');
      if (codeSpan) {
        codeSpan.onmouseover = () => { codeSpan.textContent = code; };
        codeSpan.onmouseout = () => { codeSpan.textContent = '????'; };
      }

      // Stage 2 Timer Logic
      const timerBar = byId('stage2-timer-bar');
      if (timerBar) {
        if (this.stage2.stage2WaitingForFirstKey) {
          // If we are waiting, just show a full, static timer bar
          timerBar.style.transition = 'none';
          timerBar.style.transform = 'scaleX(1)';
        } else {
          // Otherwise, start the countdown animation.
          timerBar.classList.remove('low-time');
          timerBar.style.transition = 'none';
          timerBar.style.transform = 'scaleX(1)';
          void timerBar.offsetWidth; // Trigger reflow
          timerBar.style.transition = `transform ${this.stage2.stage2TimerDuration / 1000}s linear`;
          timerBar.style.transform = 'scaleX(0)';
          if (this.stage2.stage2TimerDuration <= 2000) {
              timerBar.classList.add('low-time');
          }
          // Only set the timeout if we are actually running the timer
          this._stage2TimerId = setTimeout(() => {
            this._endStage2TrialAsError();
          }, this.stage2.stage2TimerDuration);
        }
      }
    },

    handleStage2Error() {
      AudioManager.playError();
      const code = this.currentSet[this.stage2.currentIdx].code.toUpperCase();
      this.stage2.hintLevel = Math.min(this.stage2.hintLevel + 1, 4);
      const hintStr = this.getHintString(code, this.stage2.hintLevel);
      const hintEl = byId('stage2-hint');
      // Find the new span and attach hover events for the hint
      const codeSpan = byId('stage2-code-span');
      if (codeSpan) {
        codeSpan.textContent = hintStr;
        codeSpan.onmouseover = () => { codeSpan.textContent = code; };
        codeSpan.onmouseout = () => { codeSpan.textContent = hintStr; };
      }
      clearTimeout(this.stage2.errorFlashTimerId);
      hintEl.style.color = 'var(--error)';
      this.stage2.errorFlashTimerId = setTimeout(() => {
        hintEl.style.color = '';
      }, 600);

      this.stage2.typed = '';
    },

    renderPackOverview(packOrAll) {
      const table = byId('pack-overview-table');
      if (!table) return;
      const height = this._packHeightCache[packOrAll] || 'auto';
      table.style.setProperty('--ov-cell-h', height + 'px');
      
      table.innerHTML = '';
      let items = [];
      if (packOrAll === '__ALL__') {
        items = [].concat(...Object.values(this.symbolSets));
      } else {
        items = (this.symbolSets[packOrAll] || []).slice();
      }
      
      const tbody = document.createElement('tbody');
      for (let i = 0; i < items.length; i += 4) {
        const tr = document.createElement('tr');
        for (let j = 0; j < 4; j++) {
          const td = document.createElement('td');
          const item = items[i + j];
          if (item) {
            td.dataset.symbolCode = item.code;
            td.onclick = () => this.handleSymbolToggle(item);
            
            const sym = document.createElement('span');
            sym.className = 'ov-symbol';
            sym.textContent = item.symbol;
            const name = document.createElement('span');
            name.className = 'ov-name';
            let mainName = item.name;
            let qualifier = '';
            const match = item.name.match(/^(.+?)\s*\((.+)\)$/);
            if (match) {
              mainName = match[1].trim();
              qualifier = match[2].trim();
            }
            name.textContent = ` "${mainName}"` + (qualifier ? ` (${qualifier})` : '');
            td.appendChild(sym);
            td.appendChild(name);
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    },

    _updatePackOverviewStyles() {
      const cells = document.querySelectorAll('#pack-overview-table td[data-symbol-code]');
      cells.forEach(cell => {
        const symbolCode = cell.dataset.symbolCode;
        const isActive = this.activeSymbolCodes.has(symbolCode);
        cell.className = isActive ? 'active-symbol' : 'inactive-symbol';
      });
    },

    handleSymbolToggle(symbolObj) {
      const symbolCode = symbolObj.code;

      if (this.activeSymbolCodes.has(symbolCode)) {
        if (this.activeSymbolCodes.size <= this.minStage1Size) {
            AudioManager.playError();
            return; 
        }
        this.activeSymbolCodes.delete(symbolCode);
      } else {
        this.activeSymbolCodes.add(symbolCode);
      }

      if (this.stage === 1) {
          this._rebuildCurrentStageFromActiveSymbols();
      } else if (this.stage === 2) {
          this._rebuildStage2();
       } else if (this.stage ===3) {
          this._rebuildStage3();
       }

      // OLD: This one call now handles the entire state reconciliation correctly.
      // this._rebuildCurrentStageFromActiveSymbols();

      this._updatePackOverviewStyles();
      
      this.stage1TargetCount = this.activeSymbolCodes.size;
      const s1SizeSettings = byId('settings-stage1-size-select');
      if (s1SizeSettings) {
          this.populateStage1SizeOptions(s1SizeSettings, this.currentPackName);
          s1SizeSettings.value = String(this.activeSymbolCodes.size);
      }
      AudioManager.playSymbolSelect();
    },

    _rebuildCurrentStageFromActiveSymbols() {
      if (this.stage !== 1 || !this.stage1) return;
      const st = this.stage1;

      // Establish a consistent "before" and "after" state.
      const oldWorkingSet = this.currentWorkingSet.slice();
      const oldIndices = (st.indices || []).slice();

      // Update the world to its new state.
      this._buildWorkingSetFromActiveCodes();
      this.stage1IndicesPool = Array.from({ length: this.currentWorkingSet.length }, (_, i) => i);
      if (this.orderMode === 'random') {
        this.stage1IndicesPool = shuffle(this.stage1IndicesPool);
      }

      // Capture the snapshot of what was on screen, using the saved old state.
      const codesOnScreen = new Set(oldIndices.map(i => oldWorkingSet[i]?.code).filter(Boolean));

      // STATE RECONCILIATION LOGIC 
      if (!st.practiceDone) {
        // PATH 1: Practice is not done. Full reset is required.
        this.initStage1();
        return;
      }

      // This is the new, more robust check. A soft reset is needed if the set of symbols
      // on screen is not identical to the new set of active symbols.
      const newSymbolSet = this.activeSymbolCodes;
      const needsSoftReset = (codesOnScreen.size !== newSymbolSet.size) || ![...codesOnScreen].every(code => newSymbolSet.has(code));

      if (this._showAllSymbolsOverride) {
        if (st._originalIndicesBeforeOverride === null) st._originalIndicesBeforeOverride = st.indices.slice();
        st.indices = this.stage1IndicesPool.slice();
      } else {
        if (st._originalIndicesBeforeOverride !== null) {
          st.indices = st._originalIndicesBeforeOverride;
          st._originalIndicesBeforeOverride = null;
        } else if (needsSoftReset) {
          // 1. Start with the codes that were on screen before the change.
          const finalCodesForRound = new Set(oldIndices.map(i => oldWorkingSet[i]?.code).filter(Boolean));
          // 2. Add any newly activated symbols to the round.
          const oldActiveCodes = new Set(oldWorkingSet.map(s => s.code));
          for (const code of this.activeSymbolCodes) {
            if (!oldActiveCodes.has(code)) finalCodesForRound.add(code);
          }
          // 3. Remove any deactivated symbols from the round.
          for (const code of oldActiveCodes) {
            if (!this.activeSymbolCodes.has(code)) finalCodesForRound.delete(code);
          }

          /* ---START OF DEBUG---
          // 1. we get a definitive list of all "seen" symbol codes from BEFORE the change
          const seenCodes = new Set();
          if (st.seenIndices) {
            st.seenIndices.forEach(index => {
              if (oldWorkingSet[index]) {
                seenCodes.add(oldWorkingSet[index].code);
              }
            });
          }
          // 2. We get the list of "active" symbol codes from AFTER the change.
          const activeCodes = this.activeSymbolCodes;

          // 3. We find the intersection: the codes that are in BOTH the "seen" list AND the "active" list.
          // This is the definitive list of symbols that should be in the round.
          const correctCodesForRound = [...seenCodes].filter(code => activeCodes.has(code));

          // 4. FOR TESTING ONLY: We will log this result to the console instead of updating the game.
          console.log("Correct symbols for this round:", correctCodesForRound);
          
          END OF DEBUG */ 

          // Old definitely working version of the code. Revert to this thingy below if u fuck up too hard
          // const symbolsToShow = this.currentWorkingSet.filter(symbol => finalCodesForRound.has(symbol.code));


          let codesToActuallyShow;
          if (this.showNewSymbolsImmediately) {
            codesToActuallyShow = [...finalCodesForRound];
          } else {
            const seenCodes = new Set();
            if (st.seenIndices) {
              st.seenIndices.forEach(index => {
                if (oldWorkingSet[index]) {
                  seenCodes.add(oldWorkingSet[index].code);
                }
              });
            }
            codesToActuallyShow = [...finalCodesForRound].filter(code => seenCodes.has(code));
          }

          const symbolsToShow = this.currentWorkingSet.filter(symbol => codesToActuallyShow.includes(symbol.code));
          const newIndicesForRound = symbolsToShow.map(symbol => this.currentWorkingSet.indexOf(symbol));
          st.indices = newIndicesForRound;
          
          st.rowStatus = st.indices.map(() => ({ completed: false }));

          const eligibleRows = Array.from({ length: st.indices.length }, (_, i) => i);
          const displayRound = Math.max(1, st.displayRound || 1);
          const offsetFromFirstRecall = Math.max(0, displayRound - 3);
          const plannedBatchSize = Math.min(Math.floor(offsetFromFirstRecall / 2) + 1, eligibleRows.length);
          st.hiddenPlanned = this.selectHiddenBatch(eligibleRows, plannedBatchSize, 'weak');
          st.visibleRequired = st.indices.map((_, i) => i).filter(i => !st.hiddenPlanned.includes(i));

          st.currentRow = 0;
          st.hiddenIndex = null;
          st.visibleIndex = null;

          this.renderStage1Table();
          this.updateProgressDisplay();
          this.updateFooter();
          this.updateDebugPanel();
          this.startNewHiddenRow();
          return;
        }
      }

      // Final render for paths 2, 3, and the cases where no soft reset was needed.
      st.rowStatus = st.indices.map(idx => ({ completed: this.symbolProgress[this.currentWorkingSet[idx]?.code]?.completed || false }));
      this.renderStage1Table();
      this.updateProgressDisplay();
      this.updateFooter();
      this.updateDebugPanel();
    },

    async _precalculateAllPackHeights() {
      const measurementDiv = document.createElement('div');
      measurementDiv.style.position = 'absolute';
      measurementDiv.style.top = '-9999px';
      measurementDiv.style.left = '-9999px';
      measurementDiv.style.width = '800px';
      document.body.appendChild(measurementDiv);

      const packKeysToCalculate = [...Object.keys(this.symbolSets), '__ALL__'];

      for (const packName of packKeysToCalculate) {
        const tempTable = document.createElement('table');
        tempTable.className = 'overview-table';
        
        let items;
        if (packName === '__ALL__') {
          items = [].concat(...Object.values(this.symbolSets));
        } else {
          items = this.symbolSets[packName];
        }

        const tbody = document.createElement('tbody');
        for (let i = 0; i < items.length; i += 4) {
          const tr = document.createElement('tr');
          for (let j = 0; j < 4; j++) {
            const item = items[i + j];
            const td = document.createElement('td');
            if (item) {
              td.innerHTML = `<span class="ov-symbol">${item.symbol}</span><span class="ov-name"> "${item.name}"</span>`;
            }
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        tempTable.appendChild(tbody);
        measurementDiv.appendChild(tempTable);

        await new Promise(resolve => requestAnimationFrame(resolve));

        const cells = tempTable.querySelectorAll('td');
        const names = tempTable.querySelectorAll('.ov-name');
        names.forEach(name => { name.style.whiteSpace = 'nowrap'; });
        let maxH = 0;
        cells.forEach(cell => { maxH = Math.max(maxH, cell.offsetHeight); });
        names.forEach(name => { name.style.whiteSpace = ''; });
        
        const normalized = Math.ceil(maxH + 1);
        this._packHeightCache[packName] = normalized;

        measurementDiv.innerHTML = '';
      }

      document.body.removeChild(measurementDiv);
    },

    _endStage2TrialAsError() {
      // Prevent multiple error calls from overlapping
      if (this.stage2.isTransitioning) return;
      
      this.stage2.isTransitioning = true;
      clearTimeout(this._stage2TimerId);
      AudioManager.playError();

      // Reset streak and timer duration using the new specific variable name
      if (this.currentSet.length <= 10) {
        this.stage2.streakForTimer = 0;
        this.stage2.stage2TimerDuration = 5000;
      }
      
      // (PLACEHOLDER) Update Beta distribution stats for the failed symbol.
      // const failedSymbolIndex = this.stage2.currentIdx;
      // const failedSymbolCode = this.currentSet[failedSymbolIndex].code;
      // updateStats(failedSymbolCode, { hiddenFailure: true });
      
      this.showReinforcementTable(() => {
        this.stage2.isTransitioning = false;
        this.startStage2Trial();
      });
    },

    /* Render the Stage 2 layout: displays the current symbol and
       interactive hint input. */
    renderStage2() {
      const container = byId('game-container');
      container.innerHTML = '';
      const stage2div = createElement('div', { class: 'stage2-container' });
      // Symbol display
      const symbolEl = createElement('div', { id: 'stage2-symbol', class: 'stage2-symbol' }, []);
      // Hint display
      const hintEl = createElement('div', { id: 'stage2-hint', class: 'stage2-hint' }, []);
      stage2div.appendChild(symbolEl);
      stage2div.appendChild(hintEl);

      // Trying out a timer bar; adjust the style in the CSS
      const timerEl = createElement('div', { id: 'stage2-timer' }, [
          createElement('div', { id: 'stage2-timer-bar' })
      ]);
      stage2div.appendChild(timerEl);

      // Stage 2 Waiting for player to Start Prompt
      const promptEl = createElement('div', { id: 'stage2-start-prompt' }, ['Press Any Key To Start']);
      // Conditionally enable the animation based on our new flag
      if (this.animationsActive) {
        promptEl.classList.add('prompt-animated');
      }
      stage2div.appendChild(promptEl);

      // Reinforcement table placeholder
      const reinforceEl = createElement('div', { id: 'reinforcement-container' });
      stage2div.appendChild(reinforceEl);
      container.appendChild(stage2div);
    },

    /* Begin a Stage 2 trial by selecting the next symbol and resetting
       input state.
    startStage2Trial() {
      // If queue is empty, requeue all indices
      if (this.stage2.queue.length === 0) {
        this.stage2.queue = (this.orderMode === 'random') ? shuffle(this.stage2.indices.slice()) : this.stage2.indices.slice();
      }
      // Pop the next index
      const idx = this.stage2.queue.shift();
      this.stage2.currentIdx = idx;
      this.stage2.typed = '';
      this.stage2.hintLevel = 0;
      // Update UI
      const symbol = this.currentSet[idx];
      byId('stage2-symbol').textContent = symbol.symbol;
      byId('stage2-hint').textContent = '⌥ + ????';
    }, */

    /* Compute a hint string for a given code and hint level.  Level 0
       means no hint, 1 reveals last character, 2 reveals last two,
       etc. */
    getHintString(code, level) {
      const chars = code.split('');
      const revealed = chars.map((ch, i) => {
        if (i >= chars.length - level) {
          return ch;
        }
        return '?';
      });
      return revealed.join('');
    },

    /* Handle key presses during Stage 2 active recall. */
    handleStage2Key(e) {
      if (this.stage2.stage2WaitingForFirstKey) {
        // list of keys to ignore so system commands don't start the game
        // Exception for accessibility: do not start game on Tab press.
        const keysToIgnore = ['Tab', 'Alt', 'Meta'];
        if (keysToIgnore.includes(e.key)) {
          return;
        }

        this.stage2.stage2WaitingForFirstKey = false;
        // Remove the "Press Any Key To Start" prompt
        const promptEl = byId('stage2-start-prompt');
        if (promptEl) promptEl.remove();

        // Manually start the timer now.
        const timerBar = byId('stage2-timer-bar');
        if (timerBar) {
            timerBar.classList.remove('low-time');
            timerBar.style.transition = `transform ${this.stage2.stage2TimerDuration / 1000}s linear`;
            timerBar.style.transform = 'scaleX(0)';
            if (this.stage2.stage2TimerDuration <= 2000) {
                timerBar.classList.add('low-time');
            }
        }
        this._stage2TimerId = setTimeout(() => {
            this._endStage2TrialAsError();
        }, this.stage2.stage2TimerDuration);
      }

      if (!this.isAltDown || this.stage2.currentIdx === null || this.stage2.isTransitioning) return;
      // Ignore modifier keys
      if (['Alt', 'AltGraph', 'Shift', 'Control', 'Meta', 'Tab'].includes(e.key)) {
        return;
      }
      // Determine typed character from physical key
      let typedChar = null;
      if (/^Digit[0-9]$/.test(e.code)) {
        typedChar = e.code.slice(5);
      } else if (/^Key[A-F]$/.test(e.code)) {
        typedChar = e.code.slice(3);
      }
      if (!typedChar) {
        this.handleStage2Error();
        return;
      }
      typedChar = typedChar.toUpperCase();
      const symbolIndex = this.stage2.currentIdx;
      const code = this.currentSet[symbolIndex].code.toUpperCase();
      
      const pos = this.stage2.typed.length;
      const expectedChar = code[pos];

      /* Provide immediate positive feedback for partial input by
         updating the hint field. We keep hint masked until
         completion or error. */
      if (typedChar === expectedChar) {
        this.stage2.typed += typedChar;
        const currentDisplay = this.stage2.typed + '????'.slice(this.stage2.typed.length);


        const codeSpan = byId('stage2-code-span');
        if (codeSpan) codeSpan.textContent = currentDisplay;
        // byId('stage2-hint').textContent = '⌥ + ' + currentDisplay;

        AudioManager.playKeyPress(pos);

        // When typed length reaches 4, evaluate answer
        if (this.stage2.typed.length === 4) {
          // Success
          AudioManager.playSuccess();
          // Increment count
          this.stage2.roundsCompleted++;

          const symbolCode = this.currentSet[symbolIndex].code;
          this.stage2Progress[symbolCode].recalls++;
          this.stage2.correctCount[symbolIndex] = this.stage2Progress[symbolCode].recalls;

          this.stage2.successCounter++;
          this.updateProgressDisplay();
          this.updateFooter();
          // Show the fully typed code in green
          byId('stage2-hint').textContent = '⌥ + ' + code;
          byId('stage2-hint').style.color = 'var(--success)';
          // Show reinforcement table if frequency requirement met
          let showReinforce = false;
          if (this.stage2.showFrequency !== Infinity) {
            showReinforce = (this.stage2.successCounter % this.stage2.showFrequency === 0);
          }
          // After first round of successes for each symbol, increase frequency
          const allAtLeastOne = Object.values(this.stage2.correctCount).every(cnt => cnt >= 1);
          const allAtLeastTwo = Object.values(this.stage2.correctCount).every(cnt => cnt >= 2);
          if (allAtLeastOne && this.stage2.showFrequency === 1) {
            this.stage2.showFrequency = 2;
          } else if (allAtLeastTwo && this.stage2.showFrequency === 2) {
            this.stage2.showFrequency = Infinity;
          }
          // If Stage 2 is completed (all symbols have been recalled at least twice and showFrequency is Infinity)
          if (allAtLeastTwo && this.stage2.showFrequency === Infinity) {
            // Delay briefly to show success feedback then advance
            setTimeout(() => {
              this.startStage3();
            }, 800);
            return;
          }
          // Show reinforcement table if needed
          if (showReinforce) {
            this.showReinforcementTable(() => {
              // Continue with next trial
              this.startStage2Trial();
            });
          } else {
            // Proceed to next trial after a short delay
            setTimeout(() => {
              // Reset hint style
              byId('stage2-hint').style.color = '';
              this.startStage2Trial();
            }, 500);
          }
        }
      } else {
        // Wrong answer
        this.handleStage2Error();
      }
    },

    /* Show the reinforcement table in Stage 2.  After a brief display
       it automatically hides and resumes the next trial via a
       callback. */
    showReinforcementTable(callback) {
      const reinforceContainer = byId('reinforcement-container');
      reinforceContainer.innerHTML = '';
      const table = createElement('table', { class: 'symbol-table reinforcement-table' });
      const thead = createElement('thead', {}, [
        createElement('tr', {}, [
          createElement('th', {}, ['Symbol']),
          createElement('th', {}, ['Name']),
          createElement('th', {}, ['Unicode Input'])
        ])
      ]);
      table.appendChild(thead);
      const tbody = createElement('tbody');
      this.stage2.indices.forEach(idx => {
        const sym = this.currentSet[idx];
        const tr = createElement('tr', {});
        const tdSym = createElement('td', {}, [sym.symbol]);
        const tdName = createElement('td', {}, [sym.name]);
        const tdCode = createElement('td', { class: 'code' }, [sym.code]);
        tr.appendChild(tdSym);
        tr.appendChild(tdName);
        tr.appendChild(tdCode);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      reinforceContainer.appendChild(table);
      // Fade in; then remove after delay and call callback
      table.style.opacity = '0';
      table.style.transition = 'opacity 0.4s ease-out';
      requestAnimationFrame(() => {
        table.style.opacity = '1';
      });
      setTimeout(() => {
        // Fade out
        table.style.opacity = '0';
        setTimeout(() => {
          reinforceContainer.innerHTML = '';
          callback();
        }, 400);
      }, 2000);
    },

    /* Initialise Stage 3 and render the recognition quiz layout. */
    startStage3() {
      this.stage = 3;
      AudioManager.playStageAdvanceJingle();
      // Stage 3 can use any symbols from the current pack.  
      // To maintain difficulty, include up to ten from the pack.
      const maxChoices = Math.min(this.currentSet.length, 10);
      this.stage3 = {
        indices: [...Array(maxChoices).keys()],
        round: 0,
        totalRounds: 12,
        score: 0,
        current: null
      };
      this.renderStage3();
      this.updateProgressDisplay();
      this.startStage3Round();
    },

    /* Render the Stage 3 interface: code display, choice buttons and
       scoreboard. */
    renderStage3() {
      const container = byId('game-container');
      container.innerHTML = '';
      const wrapper = createElement('div', { class: 'stage3-container' });
      const codeEl = createElement('div', { id: 'stage3-code', class: 'stage3-code' });
      const choicesEl = createElement('div', { id: 'stage3-choices', class: 'choices' });
      const scoreboard = createElement('div', { id: 'stage3-score', class: 'scoreboard' });
      wrapper.appendChild(codeEl);
      wrapper.appendChild(choicesEl);
      wrapper.appendChild(scoreboard);
      container.appendChild(wrapper);
    },

    /* Start a new round of the Stage 3 quiz. */
    startStage3Round() {
      // If we have reached the target number of rounds, end Stage 3
      if (this.stage3.round >= this.stage3.totalRounds) {
        this.finishStage3();
        return;
      }
      this.stage3.round++;
      // Choose a random symbol for the quiz
      const allIndices = this.stage3.indices;
      const correctIndex = allIndices[Math.floor(Math.random() * allIndices.length)];
      const correctSymbol = this.currentSet[correctIndex];
      this.stage3.current = correctIndex;
      // Build choices array containing the correct symbol plus two or
      // three distractors
      const distractorIndices = shuffle(allIndices.filter(i => i !== correctIndex)).slice(0, 2);
      const choiceIndices = shuffle([correctIndex, ...distractorIndices]);
      // Render code
      const codeEl = byId('stage3-code');
      codeEl.textContent = '⌥ + ' + correctSymbol.code;
      // Render choice buttons
      const choicesEl = byId('stage3-choices');
      choicesEl.innerHTML = '';
      choiceIndices.forEach(idx => {
        const sym = this.currentSet[idx];
        const btn = createElement('button', { class: 'choice-button' }, [sym.symbol]);
        btn.addEventListener('click', () => this.handleStage3Choice(idx, btn));
        choicesEl.appendChild(btn);
      });
      // Update scoreboard
      this.updateStage3Scoreboard();
    },

    /* Update the Stage 3 scoreboard display. */
    updateStage3Scoreboard() {
      const sb = byId('stage3-score');
      sb.textContent = `Round ${this.stage3.round} of ${this.stage3.totalRounds}  •  Score: ${this.stage3.score}`;
    },

    /* Handle the player clicking on a Stage 3 choice. */
    handleStage3Choice(chosenIdx, buttonEl) {
      // Disable further clicks until next round
      const choiceButtons = document.querySelectorAll('.choice-button');
      choiceButtons.forEach(btn => btn.disabled = true);
      const correctIdx = this.stage3.current;
      const correctButton = Array.from(choiceButtons).find(btn => {
        return btn.textContent === this.currentSet[correctIdx].symbol;
      });
      if (chosenIdx === correctIdx) {
        // Correct
        buttonEl.classList.add('correct');
        this.stage3.score++;
        AudioManager.playSuccess();
      } else {
        // Incorrect
        buttonEl.classList.add('wrong');
        if (correctButton) correctButton.classList.add('correct');
        AudioManager.playError();
      }
      this.updateStage3Scoreboard();
      // Proceed to next round after a short delay
      setTimeout(() => {
        this.startStage3Round();
      }, 800);
    },

    /* End of Stage 3: display final score and offer to restart the
       game. */
    finishStage3() {
      const container = byId('game-container');
      container.innerHTML = '';
      const summary = createElement('div', { class: 'stage3-container' });
      const heading = createElement('h2', {}, ['Quiz Complete']);
      const scoreText = createElement('p', {}, [
        `You answered ${this.stage3.score} out of ${this.stage3.totalRounds} correctly.`
      ]);
      const restartBtn = createElement('button', { class: 'primary-button' }, ['Play Again']);
      restartBtn.addEventListener('click', () => {
        this.startGame();
      });
      const switchPackBtn = createElement('button', { class: 'primary-button', style: 'margin-left: 1rem;' }, ['Change Pack']);
      switchPackBtn.addEventListener('click', () => {
        // Show onboarding again to pick a new pack
        byId('onboarding').classList.remove('hidden');
        byId('top-bar').classList.add('hidden');
        byId('game-container').classList.add('hidden');
      });
      summary.appendChild(heading);
      summary.appendChild(scoreText);
      summary.appendChild(restartBtn);
      summary.appendChild(switchPackBtn);
      container.appendChild(summary);
      this.updateProgressDisplay();
    }
  };

  // Initialise the game once the DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    UnicodeTyper.init();
  });

  window.UnicodeTyper = UnicodeTyper;
})();