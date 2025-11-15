const select = (selector, context=document) => context.querySelector(selector);
const selectAll = (selector, context=document) => Array.from(context.querySelectorAll(selector));

const prefs = {
  theme: localStorage.getItem('theme') || 'auto',
  mute:  localStorage.getItem('mute') === 'true',
  motion: localStorage.getItem('motion') !== 'false',
};
document.documentElement.setAttribute('data-theme', prefs.theme);

const fmtPages = [
  { id:'home', label:'Home' },
  { id:'resume', label:'Resume' },
  { id:'projects', label:'Projects' },
  { id:'blog', label:'Blog' },
  { id:'contact', label:'Contact' },
];

function hydrateSettingsMenu(){
  const group = select('#pagesGroup');
  const frag = document.createDocumentFragment();
  const title = document.createElement('div');
  title.className = 'muted';
  title.style.padding = '6px 10px';
  title.textContent = 'Pages';
  frag.appendChild(title);
  const isBlog = document.body.classList.contains('is-blog');
  const hrefPrefix = isBlog ? '../index.html#' : '#';
  fmtPages.forEach(p => {
    const a = document.createElement('a');
    a.href = `${hrefPrefix}${p.id}`;
    a.className='menuitem';
    a.role='menuitem';
    a.textContent = p.label;
    a.addEventListener('click', closeMenu);
    a.dataset.tone = '';
    frag.appendChild(a);
  });
  group.replaceChildren(frag);
}
hydrateSettingsMenu();

const menuBtn = select('#settingsBtn');
const menu    = select('#settingsMenu');
function closeMenu(){ menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded','false'); }
menuBtn.addEventListener('click', ()=>{ const open = menu.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', String(open)); });
document.addEventListener('click',(e)=>{ if(!menu.contains(e.target) && e.target!==menuBtn) closeMenu(); });

const contact = select('#contactDetails');
const contactSummary = contact.querySelector('summary');
let contactCloseTimer = null; // To hold the timeout for auto-closing
const CONTACT_CLOSE_DELAY = 5000; // 5 seconds

// Manually toggle the 'open' state on click
contactSummary.addEventListener('click', (e) => {
  e.preventDefault();
  contact.open = !contact.open;
});

// Sync ARIA attribute whenever the state changes
contact.addEventListener('toggle', () => {
  contactSummary.setAttribute('aria-expanded', contact.open ? 'true' : 'false');
});

// Close the panel when the user clicks anywhere else on the page
document.addEventListener('click', (e) => {
  // Check if the panel is open and if the click was outside of the contact element
  if (contact.open && !contact.contains(e.target)) {
    contact.open = false;
  }
});

// tart a timer to close the panel when the mouse leaves its area
contact.addEventListener('mouseleave', () => {
  if (contact.open) {
    contactCloseTimer = setTimeout(() => {
      contact.open = false;
    }, CONTACT_CLOSE_DELAY);
  }
});

// Cancel the close timer if the user's mouse re-enters the panel
contact.addEventListener('mouseenter', () => {
  if (contactCloseTimer) {
    clearTimeout(contactCloseTimer);
    contactCloseTimer = null;
  }
});

contact.addEventListener('toggle', () => {
  contactSummary.setAttribute('aria-expanded', contact.open ? 'true' : 'false');
});

const themeToggle = select('#themeToggle');
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  prefs.theme=t; localStorage.setItem('theme', t);
  const isDark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (themeToggle) {
    themeToggle.classList.toggle('dark', isDark);
  }
}
function cycleToggle(){
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur==='light' ? 'dark' : 'light';
  applyTheme(next);
}
if (themeToggle) {
  themeToggle.addEventListener('click', ()=>{ tone(); cycleToggle(); });
}
selectAll('[data-theme-opt]').forEach(btn=>btn.addEventListener('click', ()=>{ tone(); applyTheme(btn.dataset.themeOpt); }));

const muteBtn   = select('#muteBtn');
const motionBtn = select('#motionBtn');
function syncPrefsUI(){
  muteBtn.setAttribute('aria-checked', String(prefs.mute));
  muteBtn.textContent = (prefs.mute? '🔇' : '🔈') + ' ' + 'UI sounds';
  motionBtn.setAttribute('aria-checked', String(prefs.motion));
  motionBtn.textContent = (prefs.motion? '✨' : '🛑') + ' ' + 'Motion effects';
}
muteBtn.addEventListener('click', ()=>{ prefs.mute=!prefs.mute; localStorage.setItem('mute', prefs.mute); syncPrefsUI(); tone(); });
motionBtn.addEventListener('click', ()=>{
  prefs.motion = !prefs.motion;
  localStorage.setItem('motion', prefs.motion);
  syncPrefsUI();
  applyMotionPreference();
  tone();
});
syncPrefsUI();

let ticking = false;
function onScroll(){
  if(!ticking){
    window.requestAnimationFrame(()=>{
      const y = window.scrollY || 0;
      document.documentElement.style.setProperty('--glassShift', (y*0.12)+'px');
      const op = Math.min(.12, .04 + Math.min(y/1200, .08));
      document.documentElement.style.setProperty('--glassOpacity', op);
      ticking=false;
    });
    ticking = true;
  }
}
document.addEventListener('scroll', onScroll, {passive:true});
onScroll();

let audioCtx = null;
function ensureCtx(){ if(!audioCtx){ const AC = window.AudioContext || window.webkitAudioContext; audioCtx = new AC(); }}
function playTone(freq=98.0, dur=0.18, vol=Number(getComputedStyle(document.documentElement).getPropertyValue('--toneVolume'))){
  if(prefs.mute) return;
  ensureCtx();
  const startTone = () => {
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type='sine'; osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t0+0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(); osc.stop(t0 + dur + 0.02);
  };
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(startTone).catch(startTone);
  } else {
    startTone();
  }
}
const DEFAULT_TONE_FREQ = 98.00;
const tone = (freq=DEFAULT_TONE_FREQ)=> playTone(freq, 0.12, 0.25);

document.addEventListener('click', (e)=>{
  const el = e.target.closest('[data-tone]');
  if(el){
    const freq = parseFloat(el.dataset.toneFreq);
    tone(Number.isFinite(freq) ? freq : DEFAULT_TONE_FREQ);
  }
});

document.addEventListener('pointerdown', (event) => {
  const el = event.target.closest('[data-tone]');
  if (!el) return;
  ensureCtx();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(()=>{});
  }
}, { capture: true });

const projects = [
  { title:'Unicode Typer', desc:'Learn macOS Unicode Hex Input with live feedback and small audio cues.', href:'unicode-typer-game/index.html', tags:['education','web'] },

  { title:'Von Mises Distribution Explorer', desc:'Explore circular statistics with four interactive von Mises learning modules.', href:'von-mises-app-demo/index.html', tags:['stats','viz','education'] },

  { title:'Predictive Distribution Visualizer', desc:'Explore posterior predictive curves for GLMs with simple sliders.', href:'predictive-distribution-demo/predictive_distribution_app_updated.html', tags:['ml','viz'] },

  { title:'Root-Finding and Optimization Methods Playground', desc:'Compare Brent, Newton, and SPI interactively, with speed & stability plots.', href:'optimization-methods-demo/root_minimization_demo.html', tags:['math','web'] },

  { title:'Conjugate Priors Demo', desc:'An interactive visualization of Bayesian inference and conjugate priors.', href:'conjugate-priors-demo/Draft 1.2.html', tags:['stats','viz', 'ml'] },

  /*
  { title:'Dishonored 2 Mod Docs', desc:'Reverse-engineering notes for Arkane’s Void Engine: AI, scenes, .decls', href:'https://github.com/your-username/dishonored2-notes', tags:['modding','docs'] },

  { title:'GND/GHD Toolkit', desc:'Fit heavy-tailed distributions with MLE, visual diagnostics, and exports.', href:'projects/distributions/', tags:['stats','ml'] },
   */
];

const posts = [
  { title:'Have You Ever Wondered What All of the Weird Option Key Symbols Are?', 
    date:'2025-11-15', 
    href:'blog/ever-wondered-weird-option-key-characters', 
    type: 'post' },

  { title:'Does Junk Mail Help or Hurt Canada Post?', 
    date:'2025-10-11', 
    href:'blog/canada-post-junk-mail/index.html', 
    type: 'post' },

  { title:'Why hyperlegible UI matters for ML tools', 
    date:'2025-08-18', 
    href:'blog/hyperlegible-ui.html', 
    type: 'blog' },

  { title:'Evolving Legal Frameworks in the Post-Generative AI Era: User Data, AI Training Permissions, and Platform Policies at Google, Meta, and X', 
    date:'2025-08-18', 
    href:'assets/papers/Evolving_Legal_Frameworks_GenAI_Era_Draft1.1.pdf', 
    type: 'paper' },

  { title:'The Normal Equations (Simple Lesson): Part 1', 
    date:'2025-09-18', 
    href:'blog/normal-equations-lesson', 
    type: 'post' },

  { title:'Fix PDFs with Unselectable Text using OCR', 
    date:'2025-10-16', 
    href:'blog/fix-unselectable-pdfs-ocr.html', 
    type: 'tangent' },
];

function renderProjects(){
  const grid = select('#projectsGrid');
  if (!grid) return;
  const frag = document.createDocumentFragment();
  projects.forEach(p=>{
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3 style="margin:0 0 6px">${p.title}</h3>
      <p class="muted" style="margin:0 0 12px">${p.desc}</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">${p.tags.map(t=>`<span class="pill">${t}</span>`).join('')}</div>
      <a class="btn" href="${p.href}" ${p.href.startsWith('http')? 'target="_blank" rel="noopener"':''} data-tone>Open</a>`;
    frag.appendChild(card);
  });
  grid.replaceChildren(frag);
}

function renderPosts(){
  const wrap = select('#posts');
  if (!wrap) return;
  const frag = document.createDocumentFragment();
  posts.forEach(p=>{
    const a = document.createElement('a'); a.href=p.href; a.className='card'; a.style.display='block'; a.setAttribute('data-tone','');
    a.innerHTML = `
      <div class="post-meta muted">
        <span>${p.date}</span>
        <span>•</span>
        <span class="post-type">${p.type}</span>
      </div>
      <h3 style="margin:4px 0 6px">${p.title}</h3>
      <div class="muted">Read →</div>`;
    frag.appendChild(a);
  });
  wrap.replaceChildren(frag);
}

renderProjects();
renderPosts();

function showFromHash(){
  const id = (location.hash || '#home').slice(1);
  let foundSection = false;

  fmtPages.forEach(p => {
    const section = document.getElementById(p.id);
    if (section) {
      // Check if this is the section we want to show
      if (p.id === id) {
        // To show the section, REMOVE any inline display style.
        // This makes it fall back to its style from the CSS file
        // (e.g., 'flex' for #home, 'block' for others).
        section.style.display = '';
        foundSection = true;
      } else {
        // To hide all other sections, explicitly set display to 'none'.
        section.style.display = 'none';
      }
    }
  });

  // If the hash links to a valid section, focus its heading for accessibility
  if (foundSection) {
    const heading = document.querySelector(`#${id} h2`);
    if (heading) {
      heading.setAttribute('tabindex','-1');
      heading.focus({ preventScroll: true });
      heading.removeAttribute('tabindex');
    }
  }
  closeMenu();
}


window.addEventListener('hashchange', showFromHash);
showFromHash();

const yearEl = select('#year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

const obs = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.target.animate(
        [ {opacity:0, transform:'translateY(8px)'}, {opacity:1, transform:'translateY(0)'} ],
        { duration: prefs.motion? 250: 1, easing: 'ease-out' }
      );
      obs.unobserve(e.target);
    }
  });
}, { rootMargin: '0px 0px -10% 0px', threshold: .02 });
selectAll('.card, .btn').forEach(el=>obs.observe(el));

document.addEventListener('mousemove', (e)=>{
  document.documentElement.style.setProperty('--shimmerX', ( (e.clientX / window.innerWidth) * 40 - 20 ) + '%');
}, {passive:true});


// Create a new IntersectionObserver for the interest list reveal effect

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    // This is much simpler. If it's on screen, reveal it. Otherwise, hide it.
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
    } else {
      entry.target.classList.remove('revealed');
    }
  });
}, {
  rootMargin: '-0% 0px -45% 0px', 
  threshold: 0
});

// Find all the categories and tell the observer to watch them
selectAll('.reveal-on-scroll').forEach(category => {
  revealObserver.observe(category);
});

function applyMotionPreference(){
  document.body.style.setProperty('--motion', prefs.motion ? '1' : '0');
  document.body.classList.toggle('motion-off', !prefs.motion);
}

applyMotionPreference();
