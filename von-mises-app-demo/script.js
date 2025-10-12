/* script.js

This JS file contains the main code for the Von Mises Distribution Explorer
demo: Math helpers, polar plot renderer, event wiring for each module, etc.

USEFUL STUFF (copy and paste)
−  : This is the unicode minus sign that looks better than just using a dash
κ  : unicode character for kappa (less confusing; don't use regular k)

*/


// Numerical constants
const TAU = 2 * Math.PI;

// Theme + audio controls ----------------------------------------------------
const rootEl = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const THEME_KEY = 'vonMisesTheme';
const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
let currentTheme = rootEl.getAttribute('data-theme') || 'light';
let userPersistedTheme = false;

let audioCtx = null;
function ensureAudioContext() {
  if (!(window.AudioContext || window.webkitAudioContext)) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq, attack, decay, volume = 0.3) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  const peak = Math.max(0, Math.min(volume, 1));
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.linearRampToValueAtTime(0, now + attack + decay);
  osc.start(now);
  osc.stop(now + attack + decay + 0.05);
}

function playToggleThump() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const thumpOsc = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  const thumpFilter = ctx.createBiquadFilter();
  thumpOsc.type = 'triangle';
  thumpOsc.frequency.setValueAtTime(68, now);
  thumpOsc.frequency.exponentialRampToValueAtTime(42, now + 0.28);
  thumpFilter.type = 'lowpass';
  thumpFilter.frequency.setValueAtTime(320, now);
  thumpFilter.Q.setValueAtTime(0.75, now);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.55, now + 0.05);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  thumpOsc.connect(thumpFilter).connect(thumpGain).connect(ctx.destination);

  const subOsc = ctx.createOscillator();
  const subGain = ctx.createGain();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(34, now);
  subGain.gain.setValueAtTime(0.0001, now);
  subGain.gain.exponentialRampToValueAtTime(0.25, now + 0.06);
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  subOsc.connect(subGain).connect(ctx.destination);

  thumpOsc.start(now);
  subOsc.start(now);
  thumpOsc.stop(now + 0.5);
  subOsc.stop(now + 0.4);
}

function applyTheme(theme, persist = false) {
  currentTheme = theme === 'dark' ? 'dark' : 'light';
  rootEl.setAttribute('data-theme', currentTheme);
  if (themeToggle) {
    themeToggle.classList.toggle('dark', currentTheme === 'dark');
    themeToggle.setAttribute('aria-pressed', currentTheme === 'dark' ? 'true' : 'false');
    const label = currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    themeToggle.setAttribute('aria-label', label);
    themeToggle.setAttribute('title', label);
  }
  if (persist) {
    userPersistedTheme = true;
    try {
      localStorage.setItem(THEME_KEY, currentTheme);
    } catch (err) {
      // Ignore storage failures (private mode, quota, etc.)
    }
  }
}

(function initialiseTheme() {
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem(THEME_KEY);
  } catch (err) {
    storedTheme = null;
  }
  if (storedTheme === 'light' || storedTheme === 'dark') {
    userPersistedTheme = true;
    applyTheme(storedTheme);
  } else {
    applyTheme(themeMediaQuery.matches ? 'dark' : 'light');
  }
})();

themeMediaQuery.addEventListener('change', (event) => {
  if (!userPersistedTheme) {
    applyTheme(event.matches ? 'dark' : 'light');
  }
});

function toggleThemeWithSound() {
  playToggleThump();
  const next = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
}

if (themeToggle) {
  themeToggle.addEventListener('pointerdown', () => { ensureAudioContext(); });
  themeToggle.addEventListener('click', toggleThemeWithSound);
}

document.addEventListener('pointerdown', () => { ensureAudioContext(); }, { once: true, capture: true });

// Global customisation parameters for the PDF curve and visualisation.
// These values are bound to UI controls in the playground and lets the user play around w the color and the width.

let curveColor = '#007acc';
let curveWidthVal = 2;

let barColor = '#0061a8';
let barOpacity = 0.6;
let heatLowColor = '#fff7cc';
let heatHighColor = '#d73027';
let particleColor = '#c03c3c';
let particleSize = 3;
let particleOpacity = 0.5;

/*
Normalize an angle to the interval [0, 2pi).
Ensures all angles wrap correctly when computing the circular statistics 
Without normalization, functions like atan2 could produce negative angles which would lead to inconsistent binning and plotting

theta (number): Angle in radians.
returns (number): Angle wrapped to [0, 2pi).
*/
function wrapAngleToZeroToTwoPi(theta) {
  const t = theta % TAU;
  return t >= 0 ? t : t + TAU;
}

/* Convert degrees to radians. */
function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

/* Convert radians to degrees. */
function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

/*
Adjust a canvas to account for high‑DPI displays.  On Retina or other
high‑density screens the canvas's backing store must have higher
resolution than its CSS display size to avoid pixelation.  This helper
obtains the device pixel ratio and scales the canvas appropriately.

canvas (HTMLCanvasElement): The canvas element to fix.
*/
function fixCanvasDPI(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = rect.width || canvas.width;
  const cssHeight = rect.height || canvas.height;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { cssWidth, cssHeight };
}

/*
Approximation of the modified Bessel function I_0(x).

The von Mises PDF divides by I_0(kappa). But I_0 grows exponentially in kappa, so a direct series expansion won’t work here
This is adapted from the Cephes library. Uses two rational approximations to balance btwn accuracy and compute:
- small |x| < 3.75
- large |x| >= 3.75
*/
function approximateModifiedBesselI_0(x) {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const y = (x / 3.75) * (x / 3.75);
    return (
      1.0 +
      y *
        (3.5156229 +
          y *
            (3.0899424 +
              y *
                (1.2067492 +
                  y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))))
    );
  } else {
    const y = 3.75 / ax;
    return (
      (Math.exp(ax) / Math.sqrt(ax)) *
      (0.39894228 +
        y *
          (0.01328592 +
            y *
              (0.00225319 +
                y *
                  (-0.00157565 +
                    y *
                      (0.00916281 +
                        y *
                          (-0.02057706 +
                            y *
                              (0.02635537 + y * (-0.01647633 + y * 0.00392377))))))))
    );
  }
}

/*
Approximation of the modified Bessel function I_1(x).

We mainly need I_1/I_0 (mean resultant length). 
Instead of doing another approximation we can get a simpler estimate by using a symmetric finite difference on I_0, aka taking its value a bit to the left and a bit to the right and then dividing the rise by run.
*/
function approximateModifiedBesselI_1(x) {
  // Use symmetric finite difference: I_1(x) ≈ (I_0(x + ε) - I_0(x - ε)) / (2ε)
  const eps = 1e-5;
  return (approximateModifiedBesselI_0(x + eps) - approximateModifiedBesselI_0(x - eps)) / (2 * eps);
}

/*
Note on higher‑order I_n(x).

This demo only uses I_0 and I_1. If you need n >= 2 later, you can
approximate I_n by differentiating the previous order numerically (finite
differences) 
*/


/*
Von Mises PDF f(theta | mu, kappa).

Returns the density at angle theta. When kappa is near 0 this is basically
uniform on the circle. The normalising constant uses I_0(kappa) and 2pi

- theta (number): Evaluation angle in radians.
- mu (number): Mean direction in radians
- kappa (number): Concentration parameter (≥ 0).
- returns (number): Density value at theta.
*/
function computeVonMisesPdf(theta, mu, kappa) {
  // When κ is very small the distribution approaches uniform. To prevent
  // numerical underflow in exp(κ cos()) returns the uniform density
  if (kappa < 1e-6) {
    return 1 / TAU;
  }
  const numerator = Math.exp(kappa * Math.cos(theta - mu));
  // Compute the normalisation constant using the global Bessel order
  // If the computed denominator is invalid, fall back to order 0
  // Normalisation uses the modified Bessel function I_0 exclusively.  The order
  // cannot vary in a true von Mises density.
  let denom = TAU * approximateModifiedBesselI_0(kappa);
  if (!isFinite(denom) || denom === 0) {
    denom = TAU;
  }
  return numerator / denom;
}

/*
Sample from the von Mises distribution using Best and Fisher's method (Acceptance–rejection)

Works across small and large kappa; as kappa -> 0 it basically reduces to uniform on [0, 2pi)
Avoids computing Bessel functions; uses basic trig and random numbers

- mu (number): mean direction (in radians)
- kappa (number): concentration (>= 0)
- returns (number): one angle in [0, 2pi)
*/
function sampleVonMises(mu, kappa) {
  if (kappa < 1e-6) {
    // Uniform distribution on [0, 2pi)
    return Math.random() * TAU;
  }
  // Parameter transformation for the acceptance–rejection algorithm
  const a = 1 + Math.sqrt(1 + 4 * kappa * kappa);
  const b = (a - Math.sqrt(2 * a)) / (2 * kappa);
  const r = (1 + b * b) / (2 * b);
  while (true) {
    const u1 = Math.random();
    const z = Math.cos(Math.PI * u1);
    const f = (1 + r * z) / (r + z);
    const c = kappa * (r - f);
    const u2 = Math.random();
    // Accept–reject criterion
    if (c * (2 - c) - u2 > 0 || Math.log(c / u2) + 1 - c >= 0) {
      const u3 = Math.random();
      const sign = u3 > 0.5 ? -1 : 1;
      const theta = mu + sign * Math.acos(f);
      return wrapAngleToZeroToTwoPi(theta);
    }
  }
}

/*
Generate N samples from a von Mises distribution

Simple loop around sampleVonMises so changes to the sampler reflect everywhere

- n (number): how many
- mu (number): mean direction (radians)
- kappa (number): concentration
- returns (number[]): array of angles in [0, 2pi)
*/
function generateVonMisesSamplesArray(n, mu, kappa) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) {
    arr[i] = sampleVonMises(mu, kappa);
  }
  return arr;
}

/*
Circular summary statistics

Mean direction and mean resultant length capture centre and concentration
Circular variance is 1 - R. Near 0 means tight, near 1 means spread out

- samples (number[]): angles in radians
- returns: { mean (rad), R, variance }
*/
function computeCircularStatistics(samples) {
  const n = samples.length;
  if (n === 0) {
    return { mean: 0, R: 0, variance: 0 };
  }
  let sumSin = 0;
  let sumCos = 0;
  for (const theta of samples) {
    sumSin += Math.sin(theta);
    sumCos += Math.cos(theta);
  }
  const mean = Math.atan2(sumSin / n, sumCos / n);
  const R = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / n;
  const variance = 1 - R;
  return { mean: wrapAngleToZeroToTwoPi(mean), R, variance };
}

/*
Estimate the von Mises parameters μ and κ via maximum likelihood.

The mean direction is estimated as the angle of the mean resultant vector.
An approximation formula proposed by Fisher (1993) is used to estimate κ
from the mean resultant length. This approximation is accurate across
the range of R and avoids solving transcendental equations.

samples (number[]): Angles in radians.
returns ({mu: number, kappa: number): } Estimated parameters.
*/
function estimateMuKappa(samples) {
  const { mean, R } = computeCircularStatistics(samples);
  let kappa;
  if (R < 0.53) {
    kappa = 2 * R + R * R * R + (5 * R * R * R * R * R) / 6;
  } else if (R < 0.85) {
    kappa = -0.4 + 1.39 * R + 0.43 / (1 - R);
  } else {
    kappa = 1 / (R * R * R - 4 * R * R + 3 * R);
  }
  if (Number.isNaN(kappa) || !Number.isFinite(kappa)) {
    kappa = 0;
  }
  return { mu: mean, kappa };
}

/*
Compute the PDF of a wrapped normal distribution.

Start with a normal on the real line, then wrap it around the circle
The PDF becomes a sum of shifted normals. We truncate to a few terms for speed

- theta (number): angle in radians
- mu (number): mean direction (radians)
- sigma (number): std dev of underlying normal
- returns (number): density at theta
*/
function wrappedNormalPDF(theta, mu, sigma) {
  // If sigma is very large the distribution approaches uniform
  if (sigma < 1e-6) {
    return 1 / TAU;
  }
  let sum = 0;
  // Sum over several wraps. 3 is usually sufficient for sigma ~ 1
  const K = 3;
  const normalization = 1 / (sigma * Math.sqrt(2 * Math.PI));
  for (let k = -K; k <= K; k++) {
    const x = theta - mu + k * TAU;
    sum += Math.exp(-(x * x) / (2 * sigma * sigma));
  }
  return normalization * sum;
}

/*
Cardioid PDF

Another circular model
f(theta) = 1/(2pi) * (1 + 2*rho*cos(theta - mu)), with |rho| <= 0.5
Useful as a simple comparison against von Mises

- theta (number): angle (radians)
- mu (number): mean direction (radians)
- rho (number): shape parameter with |rho| <= 0.5
*/
function cardioidPDF(theta, mu, rho) {
  return (1 / TAU) * (1 + 2 * rho * Math.cos(theta - mu));
}

/*
Polar plot renderer

Draws the circular plot, PDF curve, histogram and interactive bits
Used in the playground, guided tour and expert sections
Holds state (mu, kappa, samples) and exposes update()/draw()
*/
class PolarPlot {
  /*
canvas (HTMLCanvasElement): The canvas element on which to draw.
interactive (boolean): Whether the plot should allow dragging the mean.
*/
  constructor(canvas, interactive = false) {
    this.canvas = canvas;
    // Capture the correct CSS dimensions from the modified function
    const { cssWidth, cssHeight } = fixCanvasDPI(this.canvas);
    this.ctx = canvas.getContext('2d');
    // Use the correct dimensions for all drawing logic
    this.width = cssWidth;
    this.height = cssHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.radius = Math.min(this.width, this.height) / 2 - 40;
    // Distribution parameters
    this.mu = 0;
    this.kappa = 1;
    this.samples = [];
    this.bins = 60;
    // Histogram bin counts
    this.histCounts = new Array(this.bins).fill(0);
    // For dragging the mean direction handle
    this.interactive = interactive;
    this.dragging = false;
    // Visualisation mode (gradient, heatmap or particles)
    this.visMode = 'gradient';
    // Optional overlays and reference markers
    this.overlays = [];
    this.referenceAngles = [];
    // Event listeners for interactive plots
    if (interactive) {
      this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
      document.addEventListener('mousemove', this.handleMouseMove.bind(this));
      document.addEventListener('mouseup', this.handleMouseUp.bind(this));
      // Touch events for mobile friendliness
      this.canvas.addEventListener('touchstart', (e) => this.handleMouseDown(e.touches[0]));
      document.addEventListener('touchmove', (e) => this.handleMouseMove(e.touches[0]));
      document.addEventListener('touchend', () => this.handleMouseUp());
    }

    // Particle animation state for the 'particles' mode.
    // samples moving to new positions. The positions array stores
    // current particle coordinates relative to the centre. When new
    // samples arrive, targetPositions holds the destination coordinates.
    this.particlePositions = [];
    this.particleTargets = [];
    this.particleAnimating = false;
  }

  /* Set reference angles (in radians) to draw as radial guides. */
  setReferenceAngles(angles = []) {
    if (!Array.isArray(angles)) {
      this.referenceAngles = [];
    } else {
      this.referenceAngles = angles.map((a) => wrapAngleToZeroToTwoPi(a));
    }
    this.draw();
  }

  /* Configure overlay curves to draw alongside the primary PDF. */
  setOverlays(overlays = []) {
    this.overlays = Array.isArray(overlays) ? overlays : [];
    this.draw();
  }

  /* Remove any overlays from the plot. */
  clearOverlays() {
    this.overlays = [];
    this.draw();
  }

  /*
Switch visualisation mode

Options: 'gradient', 'heatmap', 'particles'
Redraw immediately. For 'particles' reset animation state

- mode (string): new mode
*/
  setVisMode(mode) {
    this.visMode = mode;
    // Reset animation state when switching to particle mode
    if (mode === 'particles') {
      // Initialise particle positions uniformly at random if none exist
      if (!this.particlePositions || this.particlePositions.length !== this.samples.length) {
        this.particlePositions = this.samples.map((theta) => {
          const r = (this.radius * 0.8) * Math.random();
          return [r * Math.cos(theta), r * Math.sin(theta)];
        });
      }
      this.particleAnimating = false;
    }
  }

  /*
Update plot state then redraw

Recomputes histogram bins and maxima, then triggers a full draw

- mu (number): mean direction (radians)
- kappa (number): concentration
- samples (number[]): angles in radians
*/
  update(mu, kappa, samples) {
    this.mu = wrapAngleToZeroToTwoPi(mu);
    this.kappa = Math.max(kappa, 0);
    this.samples = samples;
    // Compute histogram counts
    this.histCounts = new Array(this.bins).fill(0);
    const binSize = TAU / this.bins;
    let maxCount = 0;
    for (const theta of this.samples) {
      const idx = Math.floor(wrapAngleToZeroToTwoPi(theta) / binSize);
      this.histCounts[idx] += 1;
      if (this.histCounts[idx] > maxCount) maxCount = this.histCounts[idx];
    }
    this.maxHistCount = maxCount;
    // Redraw
    this.draw();
  }

  /*
Main draw routine

Clears, draws base rings and guides, then data (mode‑dependent)
Order matters: vis first, then PDF, then mean vector and handle
*/
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    // Draw background circle
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    // Draw faint background circle
    ctx.strokeStyle = '#e5e8ef';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, TAU);
    ctx.stroke();
    // Draw the interactive direction ring. This ring is thicker and
    // invites interaction for setting μ. It does not depend on the
    // current histogram.
    ctx.strokeStyle = '#f0f2f7';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 0.95, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // Reference guides such as 0° marker lines
    this.drawReferenceLines();
    // Draw data representation depending on visMode
    if (this.visMode === 'heatmap') {
      this.drawHeatmap();
    } else if (this.visMode === 'particles') {
      this.drawParticles();
    } else {
      this.drawGradientBars();
    }
    // Draw PDF curve on top
    this.drawPDFCurve();
    // Draw mean vector
    this.drawMeanVector();
    // Draw handle if interactive
    if (this.interactive) {
      this.drawHandle();
    }
  }

  /* Draw radial reference lines for specified angles. */
  drawReferenceLines() {
    if (!this.referenceAngles || this.referenceAngles.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#4b5563';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelRadius = this.radius * 1.05;
    for (const angle of this.referenceAngles) {
      const x = this.radius * 0.9 * Math.cos(angle);
      const y = this.radius * 0.9 * Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
      const deg = ((radToDeg(angle) % 360) + 360) % 360;
      const label = `${Math.round(deg)}°`;
      const lx = labelRadius * Math.cos(angle);
      const ly = labelRadius * Math.sin(angle);
      ctx.fillText(label, lx, ly);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /*
Radial histogram bars

One sector per bin; height scales with counts
Scale against max density so it visually matches the PDF curve
Small margin keeps bars inside the outer circle
*/
  drawGradientBars() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    const binSize = TAU / this.bins;
    // Precompute maximum density to scale histogram heights
    let maxDensity = 0;
    // Sample a sufficient number of points for smoothness
    const steps = 360;
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * TAU;
      const d = computeVonMisesPdf(ang, this.mu, this.kappa);
      if (d > maxDensity) maxDensity = d;
    }
    // Avoid division by zero
    const histScale = this.maxHistCount > 0 ? (this.radius * 0.8) / (this.maxHistCount) : 0;
    const pdfScale = maxDensity > 0 ? this.radius * 0.8 / maxDensity : 0;
    for (let i = 0; i < this.bins; i++) {
      const count = this.histCounts[i];
      if (count === 0) continue;
      const startAng = i * binSize;
      const endAng = startAng + binSize;
      const barHeight = count * histScale;
      // Compute RGB from the chosen barColour hex string. This allows
      // learners to customise the histogram bar appearance. barOpacity
      // controls transparency at the outer edge.
      const r = parseInt(barColor.slice(1, 3), 16);
      const g = parseInt(barColor.slice(3, 5), 16);
      const b = parseInt(barColor.slice(5, 7), 16);
      const innerAlpha = Math.max(0, Math.min(barOpacity * 0.2, 1));
      const outerAlpha = Math.max(0, Math.min(barOpacity, 1));
      // Create a radial gradient from centre to bar tip. The inner
      // region is more transparent; the outer region matches the
      // selected opacity.
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, barHeight);
      grad.addColorStop(0, `rgba(${r},${g},${b},${innerAlpha})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},${outerAlpha})`);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, barHeight, startAng, endAng);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      // Outline the bar using a slightly darker, less transparent
      // version of the bar colour.
      const outlineAlpha = Math.min(outerAlpha + 0.2, 1);
      ctx.strokeStyle = `rgba(${r},${g},${b},${outlineAlpha})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, barHeight, startAng, endAng);
      ctx.lineTo(0, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  /*
Heatmap ring

Colour around the circle reflects PDF value at each angle
Interpolate between heatLowColor and heatHighColor
No bars here; this focuses on continuous density
*/
  drawHeatmap() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    const steps = 360;
    // Precompute maximum density to normalise colours
    let maxDensity = 0;
    const densities = new Array(steps);
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * TAU;
      const d = computeVonMisesPdf(ang, this.mu, this.kappa);
      densities[i] = d;
      if (d > maxDensity) maxDensity = d;
    }
    // Draw coloured arcs around the ring. 
    // The colour scale is interpolated between heatLowColor and heatHighColor to provide
    // meaningful insight into density. Both colours are specified in hexadecimal

    const innerR = this.radius * 0.75;
    const outerR = this.radius * 0.85;
    // Extract RGB components of the low and high colours
    const lr = parseInt(heatLowColor.slice(1, 3), 16);
    const lg = parseInt(heatLowColor.slice(3, 5), 16);
    const lb = parseInt(heatLowColor.slice(5, 7), 16);
    const hr = parseInt(heatHighColor.slice(1, 3), 16);
    const hg = parseInt(heatHighColor.slice(3, 5), 16);
    const hb = parseInt(heatHighColor.slice(5, 7), 16);
    for (let i = 0; i < steps; i++) {
      const startAng = (i / steps) * TAU;
      const endAng = ((i + 1) / steps) * TAU;
      const val = densities[i] / (maxDensity || 1);
      // Interpolate RGB linearly between low and high colours
      const rr = Math.round(lr * (1 - val) + hr * val);
      const gg = Math.round(lg * (1 - val) + hg * val);
      const bb = Math.round(lb * (1 - val) + hb * val);
      ctx.beginPath();
      ctx.strokeStyle = `rgb(${rr},${gg},${bb})`;
      ctx.lineWidth = outerR - innerR;
      // Draw arc at the average radius; using stroke with large lineWidth
      ctx.arc(0, 0, (innerR + outerR) / 2, startAng, endAng);
      ctx.stroke();
    }
    ctx.restore();
  }

  /*
Particle mode

Draw each sample as a small dot with slight radial jitter
When parameters change, update positions to suggest flow
*/
  drawParticles() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    const count = this.samples.length;
    // Draw each sample as a small particle with jittered radial position
    // Compute RGB and RGBA for the chosen particle colour and opacity
    const pr = parseInt(particleColor.slice(1, 3), 16);
    const pg = parseInt(particleColor.slice(3, 5), 16);
    const pb = parseInt(particleColor.slice(5, 7), 16);
    const rgba = `rgba(${pr},${pg},${pb},${Math.max(0, Math.min(particleOpacity, 1))})`;
    ctx.fillStyle = rgba;
    for (let i = 0; i < count; i++) {
      const theta = this.samples[i];
      const baseR = this.radius * 0.8;
      // Add a small random jitter so points are not perfectly aligned
      const jitter = Math.random() * baseR * 0.05;
      const r = baseR * 0.9 + jitter;
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      ctx.beginPath();
      ctx.arc(x, y, particleSize, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /*
PDF curve (and overlays)

Sample density on a grid around the circle
Scale to ~0.8*radius and draw as a continuous path
Supports optional overlays (von Mises, wrapped normal, cardioid)
*/
  drawPDFCurve() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    const steps = 360;
    // Compute densities for primary curve and configured overlays
    const baseDensities = new Array(steps);
    let baseMax = 0;
    const overlays = Array.isArray(this.overlays) ? this.overlays : [];
    const overlayDensities = overlays.map(() => new Array(steps));
    let overlayMax = 0;
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * TAU;
      const baseVal = computeVonMisesPdf(ang, this.mu, this.kappa);
      baseDensities[i] = baseVal;
      if (baseVal > baseMax) baseMax = baseVal;
      overlays.forEach((overlay, idx) => {
        let val = 0;
        if (!overlay) return;
        if (overlay.kind === 'vonmises') {
          val = computeVonMisesPdf(ang, overlay.mu, Math.max(overlay.kappa, 0));
        } else if (overlay.kind === 'wrappedNormal') {
          val = wrappedNormalPDF(ang, overlay.mu, Math.max(overlay.sigma, 0.01));
        } else if (overlay.kind === 'cardioid') {
          val = Math.max(0, cardioidPDF(ang, overlay.mu, overlay.rho));
        } else if (typeof overlay.density === 'function') {
          val = Math.max(0, overlay.density(ang));
        }
        overlayDensities[idx][i] = val;
        if (val > overlayMax) overlayMax = val;
      });
    }
    const combinedMax = Math.max(baseMax, overlayMax, 1e-6);
    const scale = (this.radius * 0.8) / combinedMax;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const idx = i % steps;
      const ang = (idx / steps) * TAU;
      const r = baseDensities[idx] * scale;
      const x = r * Math.cos(ang);
      const y = r * Math.sin(ang);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = '#007acc';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Draw overlay curves if provided
    overlays.forEach((overlay, overlayIdx) => {
      if (!overlay) return;
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const idx = i % steps;
        const ang = (idx / steps) * TAU;
        const r = (overlayDensities[overlayIdx][idx] || 0) * scale;
        const x = r * Math.cos(ang);
        const y = r * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = overlay.color || '#e67e22';
      ctx.lineWidth = overlay.lineWidth || 2;
      if (Array.isArray(overlay.lineDash)) {
        ctx.setLineDash(overlay.lineDash);
      }
      const alpha = overlay.alpha !== undefined ? overlay.alpha : 0.7;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }


  /*
Mean resultant vector

Direction = sample mean, length = R * radius
Small arrowhead at the tip
*/
  drawMeanVector() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    const stats = computeCircularStatistics(this.samples);
    const dir = stats.mean;
    const length = stats.R * (this.radius * 0.8);
    const endX = length * Math.cos(dir);
    const endY = length * Math.sin(dir);
    // Draw main line
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Draw arrowhead
    const arrowSize = 8;
    const angle = dir;
    const arrowAngle1 = angle + Math.PI * 0.9;
    const arrowAngle2 = angle - Math.PI * 0.9;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX + arrowSize * Math.cos(arrowAngle1), endY + arrowSize * Math.sin(arrowAngle1));
    ctx.lineTo(endX + arrowSize * Math.cos(arrowAngle2), endY + arrowSize * Math.sin(arrowAngle2));
    ctx.closePath();
    ctx.fillStyle = '#c0392b';
    ctx.fill();
    ctx.restore();
  }

  /*
Draw the mean direction handle on the circumference. The handle is a
small circle that users can drag to change μ. Its position is
determined by the current μ parameter. The handle's radius is
intentionally modest to avoid obscuring the PDF.
*/
  drawHandle() {
    const ctx = this.ctx;
    // Place the handle on the interaction ring (95% of radius)
    const x = this.centerX + (this.radius * 0.95) * Math.cos(this.mu);
    const y = this.centerY + (this.radius * 0.95) * Math.sin(this.mu);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, TAU);
    ctx.fillStyle = '#c0392b';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /*
Determine whether a point lies within the handle. Used to initiate
dragging. The handle radius is fixed to 8 pixels. Coordinates are
relative to the canvas (not the translated origin).

x (number): X coordinate.
y (number): Y coordinate.
returns (boolean): True if the point is inside the handle.
*/
  isOverHandle(x, y) {
    const hx = this.centerX + (this.radius * 0.95) * Math.cos(this.mu);
    const hy = this.centerY + (this.radius * 0.95) * Math.sin(this.mu);
    const dx = x - hx;
    const dy = y - hy;
    return dx * dx + dy * dy <= 64; // 8^2
  }

  /*
Convert canvas coordinates to an angle around the centre. Returns a
value in [0, 2pi). If the click is exactly at the centre, this
function returns the current μ to avoid undefined behaviour.

x (number): X coordinate.
y (number): Y coordinate.
*/
  coordToAngle(x, y) {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    if (dx === 0 && dy === 0) return this.mu;
    const ang = Math.atan2(dy, dx);
    return wrapAngleToZeroToTwoPi(ang);
  }

  /*
Handle mouse down event. If the user clicked on the handle, set
dragging to true. Otherwise, if the click was on the circle, set μ
directly. This allows users to quickly reposition the mean without
dragging.
*/
  handleMouseDown(event) {
    // Compute canvas coordinates
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // Check if the click is near the mean vector tip.  Compute tip
    // coordinates using a fixed radius (80% of the plot radius).
    const tipLength = this.radius * 0.8;
    const tipX = this.centerX + tipLength * Math.cos(this.mu);
    const tipY = this.centerY + tipLength * Math.sin(this.mu);
    const dxTip = x - tipX;
    const dyTip = y - tipY;
    const distTip = Math.sqrt(dxTip * dxTip + dyTip * dyTip);
    if (distTip < 12) {
      // Drag the mean vector
      this.dragging = true;
    } else if (this.isOverHandle(x, y)) {
      // Drag the direction ring handle
      this.dragging = true;
    } else {
      // Set μ to the clicked angle and trigger update externally
      const ang = this.coordToAngle(x, y);
      this.mu = ang;
      // Emit a custom event so the parent can update UI
      this.canvas.dispatchEvent(
        new CustomEvent('muchange', { detail: { mu: this.mu } })
      );
      this.draw();
    }
  }

  /*
Handle mouse move. If dragging, update μ according to the pointer
position and emit an event so that external controls (sliders,
numeric inputs) remain synchronised
*/
  handleMouseMove(event) {
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ang = this.coordToAngle(x, y);
    this.mu = ang;
    this.canvas.dispatchEvent(
      new CustomEvent('muchange', { detail: { mu: this.mu } })
    );
    this.draw();
  }

  /*
Handle mouse up. Stops dragging when the pointer is released.
*/
  handleMouseUp() {
    this.dragging = false;
  }
}

/*
Application state and initialisation
*/
document.addEventListener('DOMContentLoaded', () => {
  // Define a safe wrapper for KaTeX auto-render.  On some systems
  // external scripts may fail to load due to network restrictions, which
  // would cause renderMathInElement to be undefined and break the app.
  // This helper checks for availability before attempting to render
  // mathematical formulas, ensuring that the rest of the UI remains
  // functional even when KaTeX resources are not present.
  function safeRenderMathInElement(target) {
    if (typeof renderMathInElement === 'function') {
      try {
        renderMathInElement(target, { delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ] });
      } catch (err) {
        console.error('KaTeX render error:', err);
      }
    }
  }

// The global DPI fix was removed so canvases can be scaled when they
// are created or first used. Calling fixCanvasDPI after drawing would clear
// the artwork, so constructors and setup code handle the adjustment instead.

  // Module navigation
  const navButtons = document.querySelectorAll('.nav-btn');
  const modules = document.querySelectorAll('.module');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-module');
      modules.forEach((mod) => {
        if (mod.id === target) mod.classList.add('active');
        else mod.classList.remove('active');
      });
    });
  });

  // Attach audio to all standard buttons (small-btn and nav-btn) except toggles
  document.querySelectorAll('.small-btn, .nav-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      // Differentiate toggle buttons with a digital tone; toggles are identified by id
      const id = btn.id || '';
      if (id === 'toggleFormula' || id === 'toggleStats' || id === 'toggleLearning') {
        playTone(440.0, 0.01, 0.15);
      } else {
        playTone(98.0, 0.01, 0.1);
      }
    });
  });

  // Close buttons produce a digital tone to indicate closing of overlays
  document.querySelectorAll('.close-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      playTone(440.0, 0.01, 0.15);
    });
  });

  /* Module 1: interactive playground */
  // Instantiate the polar plot for the playground with interactivity
  const plotCanvas = document.getElementById('plotCanvas');
  const playgroundPlot = new PolarPlot(plotCanvas, true);
  // Default parameters
  let muDeg = 0;
  let muRad = 0;
  // Default kappa (actual concentration) and corresponding slider exponent
  let kappa = 1;
  let N = 300;
  let samples = generateVonMisesSamplesArray(N, muRad, kappa);
  playgroundPlot.update(muRad, kappa, samples);
  // Summary update
  function updateSummary() {
    const stats = computeCircularStatistics(samples);
    document.getElementById('statMean').textContent = `${radToDeg(stats.mean).toFixed(2)}°`;
    document.getElementById('statLength').textContent = stats.R.toFixed(3);
    document.getElementById('statVariance').textContent = stats.variance.toFixed(3);
  }
  updateSummary();
  // Helper: update kappa descriptor
  function updateKappaDescriptor(k) {
    let label;
    if (k < 0.1) label = 'Uniform';
    else if (k < 1) label = 'Broad';
    else if (k < 5) label = 'Moderate';
    else if (k < 20) label = 'Concentrated';
    else label = 'Spiked';
    document.getElementById('kappaDescriptor').textContent = label;
  }
  updateKappaDescriptor(kappa);
  // Synchronise controls
  const muDegInput = document.getElementById('muDegInput');
  // Additional μ controls: a linear slider and a compact circular slider 
  // Users can toggle between the linear and circular slider using a checkbox
  const muLinearToggle = document.getElementById('muLinearToggle');
  const muDegSlider = document.getElementById('muDegSlider');
  const muCircularCanvas = document.getElementById('muCircularSlider');
  // Apply DPI fix to the µ circular slider canvas so it renders sharply
  if (muCircularCanvas) {
    const { cssWidth, cssHeight } = fixCanvasDPI(muCircularCanvas);
    muCircCSSWidth = cssWidth;
    muCircCSSHeight = cssHeight;
  }
  // Draw and interact with the circular μ slider. 
  // The mini-ring is the same as the interactive ring on the main plot it's just more compact and fits nicely into the rest of the control panel.
  // When the user drags the handle or clicks within the ring, μ updates accordingly.
  let muCircDragging = false;
  function drawMuCircular() {
    const ctx = muCircularCanvas.getContext('2d');
    const w = muCircCSSWidth; // Use the correct CSS width
    const h = muCircCSSHeight; // Use the correct CSS height
    const cx = w / 2;
    const cy = h / 2;
    const rOuter = Math.min(w, h) / 2 - 10;
    ctx.clearRect(0, 0, w, h);
    // Outer ring
    ctx.strokeStyle = '#e5e8ef';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, TAU);
    ctx.stroke();
    // Handle
    const ang = degToRad(muDeg);
    const hx = cx + rOuter * Math.cos(ang);
    const hy = cy + rOuter * Math.sin(ang);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  function muCircCoordToAngle(x, y) {
    const rect = muCircularCanvas.getBoundingClientRect();
    const cx = muCircCSSWidth / 2; // Use CSS width for center
    const cy = muCircCSSHeight / 2; // Use CSS height for center
    const dx = x - rect.left - cx;
    const dy = y - rect.top - cy;
    const ang = Math.atan2(dy, dx);
    return (ang >= 0 ? ang : ang + TAU);
  }
  muCircularCanvas.addEventListener('mousedown', (e) => {
    muCircDragging = true;
    const ang = muCircCoordToAngle(e.clientX, e.clientY);
    setPlaygroundMu(radToDeg(ang));
    drawMuCircular();
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!muCircDragging) return;
    const ang = muCircCoordToAngle(e.clientX, e.clientY);
    setPlaygroundMu(radToDeg(ang));
    drawMuCircular();
  });
  document.addEventListener('mouseup', () => {
    muCircDragging = false;
  });
  
  // Linear μ slider events
  muDegSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) setPlaygroundMu(val);
  });
  // Toggle between linear and circular slider
  function updateMuSliderToggle() {
    if (muLinearToggle.checked) {
      muDegSlider.disabled = false;
      muDegSlider.style.display = 'block';
      muCircularCanvas.style.display = 'none';
    } else {
      muDegSlider.disabled = true;
      muDegSlider.style.display = 'none';
      muCircularCanvas.style.display = 'block';
    }
  }
  muLinearToggle.addEventListener('change', updateMuSliderToggle);
  // Initialise slider toggle state on load
  updateMuSliderToggle();
  // Draw initial circular slider
  drawMuCircular();
  const kappaSlider = document.getElementById('kappaSlider');
  const sampleSizeSlider = document.getElementById('sampleSizeSlider');
  const sampleSizeInput = document.getElementById('sampleSizeInput');

  // Initialise the κ slider with the logarithm of the default κ. Without
  // this, the slider would display an inconsistent value relative to
  // the underlying concentration.
  kappaSlider.value = Math.log10(kappa);
  // Update plot when μ changes via slider or input
  function setPlaygroundMu(deg) {
    muDeg = ((deg % 360) + 360) % 360;
    muRad = degToRad(muDeg);
    // Update numeric input and slider values
    muDegInput.value = muDeg;
    muDegSlider.value = muDeg;
    // Redraw the circular slider handle
    drawMuCircular();
    // Regenerate sample and update plot
    samples = generateVonMisesSamplesArray(N, muRad, kappa);
    playgroundPlot.update(muRad, kappa, samples);
    updateSummary();
  }
  // When the numeric μ field changes, update μ
  muDegInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) setPlaygroundMu(val);
  });
  // Update μ when drag handle emits event
  plotCanvas.addEventListener('muchange', (e) => {
    muRad = e.detail.mu;
    muDeg = radToDeg(muRad);
    muDegInput.value = muDeg.toFixed(2);
    samples = generateVonMisesSamplesArray(N, muRad, kappa);
    playgroundPlot.update(muRad, kappa, samples);
    updateSummary();
  });
  // Update kappa
  /*
Update the concentration parameter based on the logarithmic slider.

The slider encodes the base‑10 logarithm of κ. Converting the
slider value back to κ via 10^val yields a range from 0.01 to 100
when the slider moves from –2 to +2. This design satisfies the
specification to use a logarithmic scale for κ, giving users
fine‑grained control over both broad and highly concentrated
distributions. After computing κ we regenerate the sample and
redraw the plot and summary.

val (number|string): The slider value (log10 κ).
*/
  function setPlaygroundKappa(val) {
    const expVal = parseFloat(val);
    // Convert logarithmic slider to actual κ
    kappa = Math.pow(10, expVal);
    kappaSlider.value = expVal;
    updateKappaDescriptor(kappa);
    samples = generateVonMisesSamplesArray(N, muRad, kappa);
    playgroundPlot.update(muRad, kappa, samples);
    updateSummary();
  }
  // Listen for changes on the κ slider and update accordingly
  kappaSlider.addEventListener('input', (e) => {
    setPlaygroundKappa(e.target.value);
  });

  /*
Allow drag‑to‑focus: when the user holds Shift and drags vertically on
the canvas, κ is adjusted. The vertical distance travelled modifies
the log10 of κ, giving a smooth feel across orders of magnitude. A
downward drag decreases κ and an upward drag increases κ. The drag
motion is relative; you can drag multiple times to refine the value.
*/
  let kappaDrag = false;
  let kappaDragStartY = 0;
  let kappaDragStartExp = 0;
  plotCanvas.addEventListener('mousedown', (e) => {
    if (e.shiftKey) {
      kappaDrag = true;
      kappaDragStartY = e.clientY;
      kappaDragStartExp = Math.log10(kappa);
      e.preventDefault();
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (kappaDrag) {
      const dy = kappaDragStartY - e.clientY;
      // Each 100 pixels vertically doubles κ approximately
      const deltaExp = dy / 200;
      const newExp = kappaDragStartExp + deltaExp;
      setPlaygroundKappa(newExp);
    }
  });
  document.addEventListener('mouseup', () => {
    kappaDrag = false;
  });
  // Update sample size
  function setSampleSize(val) {
    const num = parseInt(val);
    N = Math.max(1, Math.min(num, 5000));
    sampleSizeSlider.value = N;
    sampleSizeInput.value = N;
    samples = generateVonMisesSamplesArray(N, muRad, kappa);
    playgroundPlot.update(muRad, kappa, samples);
    updateSummary();
  }
  sampleSizeSlider.addEventListener('input', (e) => {
    setSampleSize(e.target.value);
  });
  sampleSizeInput.addEventListener('input', (e) => {
    setSampleSize(e.target.value);
  });
  // Toggle formula and summary overlays
  const formulaBox = document.getElementById('formulaBox');
  const summaryBox = document.getElementById('summaryBox');
  const toggleFormulaBtn = document.getElementById('toggleFormula');
  const toggleStatsBtn = document.getElementById('toggleStats');
  const toggleLearningBtn = document.getElementById('toggleLearning');
  const learningCenter = document.getElementById('learningCenter');

  function createToggleController(button, panel, { onShow } = {}) {
    if (!button || !panel) {
      return {
        open() {},
        close() {},
      };
    }

    const syncButton = (visible) => {
      button.classList.toggle('is-active', visible);
      button.setAttribute('aria-pressed', String(visible));
    };

    if (panel.id) {
      button.setAttribute('aria-controls', panel.id);
    }
    syncButton(!panel.hidden);

    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      const isVisible = !panel.hidden;
      syncButton(isVisible);
      if (isVisible && typeof onShow === 'function') {
        onShow();
      }
    });

    return {
      open() {
        if (panel.hidden) {
          panel.hidden = false;
          syncButton(true);
          if (typeof onShow === 'function') {
            onShow();
          }
        }
      },
      close() {
        panel.hidden = true;
        syncButton(false);
      },
    };
  }

  let formulaMathRendered = false;
  const formulaToggle = createToggleController(toggleFormulaBtn, formulaBox, {
    onShow: () => {
      if (!formulaMathRendered) {
        safeRenderMathInElement(formulaBox);
        formulaMathRendered = true;
      }
    },
  });
  const statsToggle = createToggleController(toggleStatsBtn, summaryBox);
  let learningMathRendered = false;
  const learningToggle = createToggleController(toggleLearningBtn, learningCenter, {
    onShow: () => {
      if (!learningMathRendered) {
        safeRenderMathInElement(learningCenter);
        learningMathRendered = true;
      }
    },
  });

  // Overlay close buttons
  const closeFormulaBtn = document.getElementById('closeFormula');
  const closeSummaryBtn = document.getElementById('closeSummary');
  if (closeFormulaBtn) {
    closeFormulaBtn.addEventListener('click', () => {
      formulaToggle.close();
      toggleFormulaBtn?.focus();
    });
  }
  if (closeSummaryBtn) {
    closeSummaryBtn.addEventListener('click', () => {
      statsToggle.close();
      toggleStatsBtn?.focus();
    });
  }

  // Close button in learning center
  const closeLearningBtn = document.getElementById('closeLearning');
  if (closeLearningBtn) {
    closeLearningBtn.addEventListener('click', () => {
      learningToggle.close();
      toggleLearningBtn?.focus();
    });
  }

  // After all setup is complete, schedule a redraw of the initial
  // playground plot and update summary statistics on the next
  // animation frame.  Using setTimeout ensures that canvas scaling
  // operations have completed before drawing; otherwise the plot may
  // appear blank until the first user interaction.
  setTimeout(() => {
    playgroundPlot.update(muRad, kappa, samples);
    updateSummary();
  }, 0);
  // Redraw once more after a short delay to handle cases where
  // canvases are resized after the initial draw (e.g. due to CSS
  // layout recalculations).  Without this second pass some plots may
  // appear blank until the user interacts with a control.
  setTimeout(() => {
    playgroundPlot.update(muRad, kappa, samples);
    updateSummary();
  }, 100);

  // Visualization mode controls
  const visRadios = document.querySelectorAll('input[name="visMode"]');
  visRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      const mode = document.querySelector('input[name="visMode"]:checked').value;
      playgroundPlot.setVisMode(mode);
      playgroundPlot.draw();
      // Show or hide mode‑specific control groups
      document.querySelector('.gradient-controls').style.display = mode === 'gradient' ? 'block' : 'none';
      document.querySelector('.heatmap-controls').style.display = mode === 'heatmap' ? 'block' : 'none';
      document.querySelector('.particle-controls').style.display = mode === 'particles' ? 'block' : 'none';
    });
  });
  // Set initial visibility of mode‑specific controls
  document.querySelector('.gradient-controls').style.display = 'block';
  document.querySelector('.heatmap-controls').style.display = 'none';
  document.querySelector('.particle-controls').style.display = 'none';

  // Removed formula parameter highlighting: the formula is rendered via KaTeX and no longer contains
  // interactive spans for μ and κ. If interactive highlighting is desired in the future,
  // corresponding spans and event handlers can be reintroduced.

  /* Playground customisation controls */
  // Curve appearance controls
  const curveColorPicker = document.getElementById('curveColor');
  const curveWidthSlider = document.getElementById('curveWidth');
  // Removed bessel order control: the von Mises normalisation uses I_0 exclusively.
  curveColorPicker.addEventListener('input', (e) => {
    curveColor = e.target.value;
    playgroundPlot.draw();
  });
  curveWidthSlider.addEventListener('input', (e) => {
    curveWidthVal = parseFloat(e.target.value);
    playgroundPlot.draw();
  });
  // Gradient bar mode controls
  const barColorPicker = document.getElementById('barColor');
  const barOpacitySlider = document.getElementById('barOpacity');
  barColorPicker.addEventListener('input', (e) => {
    barColor = e.target.value;
    playgroundPlot.draw();
  });
  barOpacitySlider.addEventListener('input', (e) => {
    barOpacity = parseFloat(e.target.value);
    playgroundPlot.draw();
  });
  // Heatmap controls
  const heatLowPicker = document.getElementById('heatLowColor');
  const heatHighPicker = document.getElementById('heatHighColor');
  heatLowPicker.addEventListener('input', (e) => {
    heatLowColor = e.target.value;
    playgroundPlot.draw();
  });
  heatHighPicker.addEventListener('input', (e) => {
    heatHighColor = e.target.value;
    playgroundPlot.draw();
  });
  // Particle controls
  const particleColorPicker = document.getElementById('particleColor');
  const particleSizeSlider = document.getElementById('particleSize');
  const particleOpacitySlider = document.getElementById('particleOpacity');
  particleColorPicker.addEventListener('input', (e) => {
    particleColor = e.target.value;
    playgroundPlot.draw();
  });
  particleSizeSlider.addEventListener('input', (e) => {
    particleSize = parseFloat(e.target.value);
    playgroundPlot.draw();
  });
  particleOpacitySlider.addEventListener('input', (e) => {
    particleOpacity = parseFloat(e.target.value);
    playgroundPlot.draw();
  });

  /* Module 2: guided tour */
  const tourSteps = document.querySelectorAll('.tour-step');
  let tourIndex = 0;
  function showTourStep(index) {
    tourSteps.forEach((step, i) => {
      step.classList.toggle('active', i === index);
    });
    tourIndex = index;
    if (index === 3) {
      drawLinearPlot();
      drawApproxErrorPlot();
    }
  }
  // Step 1: check answer
  document.getElementById('avgCheck').addEventListener('click', () => {
    const input = document.getElementById('avgInput').value;
    const val = parseFloat(input);
    const feedback = document.getElementById('avgFeedback');
    // The correct circular mean of 350° and 10° is 0°/360°
    if (isNaN(val)) {
      feedback.textContent = 'Please enter a number.';
      feedback.className = 'feedback error';
      return;
    }
    const answer = ((val % 360) + 360) % 360;
    if (Math.abs(answer) < 1 || Math.abs(answer - 360) < 1) {
      feedback.textContent = 'Correct! The mean direction is 0° (or 360°).';
      feedback.className = 'feedback success';
    } else {
      feedback.textContent = 'Not quite. Remember that 350° and 10° wrap around to 0°.';
      feedback.className = 'feedback error';
    }
  });

  /*
Interactive vector adder

Learners manipulate two vectors on a compact polar plot and compare the
straight average of their angles with the circular mean. The example
shows why naive arithmetic means fall apart once angles wrap.
*/
  const vectorCanvas = document.getElementById('vectorCanvas');
  if (vectorCanvas) {
    // Scale the vector addition canvas for high DPI displays
    const { cssWidth, cssHeight } = fixCanvasDPI(vectorCanvas);
    const vCtx = vectorCanvas.getContext('2d');
    const vw = cssWidth;
    const vh = cssHeight
    const vcx = vw / 2;
    const vcy = vh / 2;
    const vradius = Math.min(vw, vh) / 2 - 20;
    // State for two vectors: angles (radians) and magnitudes (0–1)
    let vAngles = [degToRad(30), degToRad(300)];
    let vMags = [1, 1];
    let draggingVector = -1;
    // Draw vector adder plot
    function drawVectorAdder() {
      vCtx.clearRect(0, 0, vw, vh);
      // Base circle
      vCtx.strokeStyle = '#dcdfe6';
      vCtx.lineWidth = 1;
      vCtx.beginPath();
      vCtx.arc(vcx, vcy, vradius, 0, TAU);
      vCtx.stroke();
      // Draw vectors
      for (let i = 0; i < 2; i++) {
        const ang = vAngles[i];
        const mag = vMags[i];
        const len = mag * vradius;
        const x = vcx + len * Math.cos(ang);
        const y = vcy + len * Math.sin(ang);
        // Line
        vCtx.strokeStyle = '#007acc';
        vCtx.lineWidth = 2;
        vCtx.beginPath();
        vCtx.moveTo(vcx, vcy);
        vCtx.lineTo(x, y);
        vCtx.stroke();
        // Handle
        vCtx.fillStyle = '#c0392b';
        vCtx.beginPath();
        vCtx.arc(x, y, 5, 0, TAU);
        vCtx.fill();
      }
      // Compute naïve linear mean of angles (degrees)
      const degs = vAngles.map((a) => radToDeg(a));
      const linMean = ((degs[0] + degs[1]) / 2 + 360) % 360;
      // Compute circular mean via vector addition
      let sumX = 0;
      let sumY = 0;
      for (let i = 0; i < 2; i++) {
        sumX += vMags[i] * Math.cos(vAngles[i]);
        sumY += vMags[i] * Math.sin(vAngles[i]);
      }
      let circMean = Math.atan2(sumY, sumX);
      circMean = ((radToDeg(circMean) % 360) + 360) % 360;
      // Update displays
      document.getElementById('linMeanDisplay').textContent = linMean.toFixed(1);
      document.getElementById('circMeanDisplay').textContent = circMean.toFixed(1);
    }
    // Determine if pointer near a vector endpoint
    function getVectorHandleIndex(x, y) {
      for (let i = 0; i < 2; i++) {
        const ang = vAngles[i];
        const mag = vMags[i];
        const len = mag * vradius;
        const px = vcx + len * Math.cos(ang);
        const py = vcy + len * Math.sin(ang);
        const dx = x - px;
        const dy = y - py;
        if (dx * dx + dy * dy <= 100) return i;
      }
      return -1;
    }
    vectorCanvas.addEventListener('mousedown', (e) => {
      const rect = vectorCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const idx = getVectorHandleIndex(x, y);
      if (idx !== -1) {
        draggingVector = idx;
        e.preventDefault();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (draggingVector === -1) return;
      const rect = vectorCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Compute angle and magnitude relative to centre
      const dx = x - vcx;
      const dy = y - vcy;
      const ang = Math.atan2(dy, dx);
      // Limit radius to plot radius
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mag = Math.min(dist / vradius, 1);
      vAngles[draggingVector] = wrapAngleToZeroToTwoPi(ang);
      vMags[draggingVector] = mag;
      drawVectorAdder();
    });
    document.addEventListener('mouseup', () => {
      draggingVector = -1;
    });
    drawVectorAdder();
  }

  /*
Rotate-to-align game

Points sampled from a von Mises distribution are shown on the circle.
Rotating the reference frame with the slider aims the cloud toward 0°.
The score reports the mean resultant length after rotation, giving a
quick read on how tightly the points cluster.
*/
  const rotateCanvas = document.getElementById('rotateCanvas');
  if (rotateCanvas) {
    // Apply DPI fix for crisp rendering
    const { cssWidth, cssHeight } = fixCanvasDPI(rotateCanvas);
    const rCtx = rotateCanvas.getContext('2d');
    const rw = cssWidth;
    const rh = cssHeight;
    const rcx = rw / 2;
    const rcy = rh / 2;
    const rradius = Math.min(rw, rh) / 2 - 20;
    // Generate a sample with a random mean and moderate κ
    let rotateBaseMu = Math.random() * TAU;
    let rotateKappa = 2;
    const rotateData = generateVonMisesSamplesArray(40, rotateBaseMu, rotateKappa);
    let rotationDeg = 0;
    function drawRotatePlot() {
      rCtx.clearRect(0, 0, rw, rh);
      // Circle boundary
      rCtx.strokeStyle = '#dcdfe6';
      rCtx.lineWidth = 1;
      rCtx.beginPath();
      rCtx.arc(rcx, rcy, rradius, 0, TAU);
      rCtx.stroke();
      // Plot rotated points
      rCtx.fillStyle = '#007acc';
      const rotRad = degToRad(rotationDeg);
      const rotatedAngles = rotateData.map((th) => wrapAngleToZeroToTwoPi(th - rotRad));
      for (const th of rotatedAngles) {
        const x = rcx + rradius * Math.cos(th);
        const y = rcy + rradius * Math.sin(th);
        rCtx.beginPath();
        rCtx.arc(x, y, 4, 0, TAU);
        rCtx.fill();
      }
      // Compute alignment measure: closeness of mean direction to 0°. We
      // measure the smallest angular distance of the rotated mean from
      // 0 and invert it so that higher scores represent better alignment.
      const stats = computeCircularStatistics(rotatedAngles);
      const meanDir = stats.mean; // rad
      const diff = Math.min(Math.abs(meanDir), TAU - Math.abs(meanDir));
      const alignment = 1 - diff / Math.PI; // between 0 and 1
      document.getElementById('alignScore').textContent = alignment.toFixed(3);
    }
    const rotateSlider = document.getElementById('rotateSlider');
    rotateSlider.addEventListener('input', () => {
      rotationDeg = parseFloat(rotateSlider.value) || 0;
      drawRotatePlot();
    });
    // Initial draw
    drawRotatePlot();
  }

  /*
Guided-tour mini quiz

Two multiple-choice questions reinforce the ideas of circular data and
concentration. Feedback appears right after submission so the learner
knows what to revisit.
*/
  const quizSubmitBtn = document.getElementById('quizSubmit');
  if (quizSubmitBtn) {
    quizSubmitBtn.addEventListener('click', () => {
      const feedback = document.getElementById('quizFeedback');
      const q1 = document.querySelector('input[name="quiz1"]:checked');
      const q2 = document.querySelector('input[name="quiz2"]:checked');
      let correct = 0;
      if (q1 && q1.value === 'b') correct++;
      if (q2 && q2.value === 'a') correct++;
      if (correct === 2) {
        feedback.textContent = 'Great job! Both answers are correct.';
        feedback.className = 'feedback success';
      } else if (correct === 1) {
        feedback.textContent = 'Almost! One answer is correct.';
        feedback.className = 'feedback error';
      } else {
        feedback.textContent = 'Not quite. Review the material on circular data.';
        feedback.className = 'feedback error';
      }
    });
  }
  // Navigation buttons
  document.getElementById('next1').addEventListener('click', () => showTourStep(1));
  document.getElementById('prev2').addEventListener('click', () => showTourStep(0));
  document.getElementById('next2').addEventListener('click', () => showTourStep(2));
  document.getElementById('prev3').addEventListener('click', () => showTourStep(1));
  document.getElementById('next3').addEventListener('click', () => showTourStep(3));
  document.getElementById('prev4').addEventListener('click', () => showTourStep(2));
  document.getElementById('finishTour').addEventListener('click', () => showTourStep(4));
  // Restart button at the end of Step 4 resets to the beginning
  document.getElementById('restartTour').addEventListener('click', () => showTourStep(0));
  // Restart button on the completion page
  const restartEndBtn = document.getElementById('restartTourEnd');
  if (restartEndBtn) {
    restartEndBtn.addEventListener('click', () => {
      showTourStep(0);
    });
  }
  // Tour plots
  const tourCanvas1 = document.getElementById('tourCanvas1');
  const tourPlot1 = new PolarPlot(tourCanvas1, true);
  let tourMu = 0;
  let tourSamples = generateVonMisesSamplesArray(300, tourMu, 1);
  tourPlot1.update(tourMu, 1, tourSamples);
  tourCanvas1.addEventListener('muchange', (e) => {
    tourMu = e.detail.mu;
    tourSamples = generateVonMisesSamplesArray(300, tourMu, 1);
    tourPlot1.update(tourMu, 1, tourSamples);
  });

  /*
Step 2 enhancements: Center of Mass Sandbox and Bimodal Challenge
*/
  const sandboxCanvas = document.getElementById('sandboxCanvas');
  const sandboxCtx = sandboxCanvas.getContext('2d');
  let sandboxPoints = [];
  /*
Draw the sandbox: base circle, points and mean vector.
*/
  function drawSandbox() {
    const w = sandboxCanvas.width;
    const h = sandboxCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 20;
    sandboxCtx.clearRect(0, 0, w, h);
    // Outer circle
    sandboxCtx.strokeStyle = '#dcdfe6';
    sandboxCtx.lineWidth = 1;
    sandboxCtx.beginPath();
    sandboxCtx.arc(cx, cy, r, 0, TAU);
    sandboxCtx.stroke();
    // Plot points
    sandboxCtx.fillStyle = '#007acc';
    for (const th of sandboxPoints) {
      const px = cx + r * Math.cos(th);
      const py = cy + r * Math.sin(th);
      sandboxCtx.beginPath();
      sandboxCtx.arc(px, py, 4, 0, TAU);
      sandboxCtx.fill();
    }
    // Compute and draw mean vector if there are points
    if (sandboxPoints.length > 0) {
      const stats = computeCircularStatistics(sandboxPoints);
      const dir = stats.mean;
      const length = stats.R * (r * 0.9);
      const ex = cx + length * Math.cos(dir);
      const ey = cy + length * Math.sin(dir);
      sandboxCtx.strokeStyle = '#c0392b';
      sandboxCtx.lineWidth = 2;
      sandboxCtx.beginPath();
      sandboxCtx.moveTo(cx, cy);
      sandboxCtx.lineTo(ex, ey);
      sandboxCtx.stroke();
      // Arrowhead
      const arrowSize = 8;
      const arrowAngle1 = dir + Math.PI * 0.8;
      const arrowAngle2 = dir - Math.PI * 0.8;
      sandboxCtx.beginPath();
      sandboxCtx.moveTo(ex, ey);
      sandboxCtx.lineTo(ex + arrowSize * Math.cos(arrowAngle1), ey + arrowSize * Math.sin(arrowAngle1));
      sandboxCtx.lineTo(ex + arrowSize * Math.cos(arrowAngle2), ey + arrowSize * Math.sin(arrowAngle2));
      sandboxCtx.closePath();
      sandboxCtx.fillStyle = '#c0392b';
      sandboxCtx.fill();
    }
  }
  // Click handler to add point
  sandboxCanvas.addEventListener('click', (e) => {
    const rect = sandboxCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cx = sandboxCanvas.width / 2;
    const cy = sandboxCanvas.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const ang = Math.atan2(dy, dx);
    sandboxPoints.push(wrapAngleToZeroToTwoPi(ang));
    drawSandbox();
  });
  // Clear button resets sandbox
  document.getElementById('sandboxClear').addEventListener('click', () => {
    sandboxPoints = [];
    drawSandbox();
  });
  // Initial draw
  drawSandbox();
  // Bimodal challenge toggle
  const bimodalBtn = document.getElementById('bimodalToggle');
  let bimodalActive = false;
  // Prepare the dedicated bimodal plot on its own canvas
  const bimodalChallengeCanvasEl = document.getElementById('bimodalChallengeCanvas');
  // Separate polar plot for the bimodal challenge in the guided tour.  Use a distinct
  // variable name to avoid clashing with the assessment bimodal plot later on.
  const bimodalChallengePlot = bimodalChallengeCanvasEl ? new PolarPlot(bimodalChallengeCanvasEl, false) : null;
  bimodalBtn.addEventListener('click', () => {
    bimodalActive = !bimodalActive;
    if (bimodalActive) {
      bimodalBtn.textContent = 'Deactivate Bimodal Example';
      // Generate two clusters: at 45° and 225°
      const mu1 = degToRad(45);
      const mu2 = degToRad(225);
      const k = 4;
      const nHalf = 150;
      const samples1 = generateVonMisesSamplesArray(nHalf, mu1, k);
      const samples2 = generateVonMisesSamplesArray(nHalf, mu2, k);
      const combined = samples1.concat(samples2);
      // Compute combined mean direction for display
      const stats = computeCircularStatistics(combined);
      const meanDir = stats.mean;
      // Update only the dedicated bimodal canvas
      if (bimodalChallengePlot) {
        bimodalChallengePlot.update(meanDir, 1, combined);
      }
    } else {
      bimodalBtn.textContent = 'Activate Bimodal Example';
      // Clear the bimodal canvas when deactivated
      if (bimodalChallengePlot) {
        bimodalChallengePlot.update(0, 1, []);
      }
    }
  });
  // Step 3: kappa exploration
  const tourCanvas2 = document.getElementById('tourCanvas2');
  const tourPlot2 = new PolarPlot(tourCanvas2, false);
  let tourKappaVal = 1;
  let tourSamples2 = generateVonMisesSamplesArray(300, 0, tourKappaVal);
  tourPlot2.update(0, tourKappaVal, tourSamples2);
  const tourKappaSlider = document.getElementById('tourKappa');
  const tourKappaLabel = document.getElementById('tourKappaLabel');
  tourKappaSlider.addEventListener('input', () => {
    tourKappaVal = parseFloat(tourKappaSlider.value);
    tourKappaLabel.textContent = `κ = ${tourKappaVal.toFixed(2)}`;
    tourSamples2 = generateVonMisesSamplesArray(300, 0, tourKappaVal);
    tourPlot2.update(0, tourKappaVal, tourSamples2);
    // Update comparison and variance plots when κ changes
    updateKappaComparisons();
    drawKappaVariancePlot(tourKappaVal);
    updateVarianceReadout(tourKappaVal);
    drawSpinner(tourKappaVal);
  });

  /*
Initialise auxiliary plots for Step 3: concentration comparison, variance plot and spinner.
*/
  const kappaLowCanvas = document.getElementById('kappaLow');
  const kappaMediumCanvas = document.getElementById('kappaMedium');
  const kappaHighCanvas = document.getElementById('kappaHigh');
  const kappaLowPlot = new PolarPlot(kappaLowCanvas, false);
  const kappaMediumPlot = new PolarPlot(kappaMediumCanvas, false);
  const kappaHighPlot = new PolarPlot(kappaHighCanvas, false);
  // Update comparison plots with fixed κ values
  function updateKappaComparisons() {
    const lowK = 0.5;
    const medK = 2;
    const highK = 8;
    const mu0 = 0;
    kappaLowPlot.update(mu0, lowK, generateVonMisesSamplesArray(200, mu0, lowK));
    kappaMediumPlot.update(mu0, medK, generateVonMisesSamplesArray(200, mu0, medK));
    kappaHighPlot.update(mu0, highK, generateVonMisesSamplesArray(200, mu0, highK));
  }
  updateKappaComparisons();
  // Variance plot
  const kappaVarianceCanvas = document.getElementById('kappaVariancePlot');
  const kvCtx = kappaVarianceCanvas ? kappaVarianceCanvas.getContext('2d') : null;
  // Fix DPI for the κ-variance plot and retain CSS dimensions for drawing math.
  const kvDims = kappaVarianceCanvas ? fixCanvasDPI(kappaVarianceCanvas) : null;
  let kvCssWidth = kvDims && kvDims.cssWidth ? kvDims.cssWidth : 0;
  let kvCssHeight = kvDims && kvDims.cssHeight ? kvDims.cssHeight : 0;
  if (kappaVarianceCanvas && (!kvCssWidth || !kvCssHeight)) {
    const rect = kappaVarianceCanvas.getBoundingClientRect();
    kvCssWidth = rect.width;
    kvCssHeight = rect.height;
  }
  const kappaVarianceReadout = document.getElementById('kappaVarianceReadout');
  const kappaVarianceValue = document.getElementById('kappaVarianceValue');
  const kappaVarianceResult = document.getElementById('kappaVarianceResult');
  function getR(k) {
    if (k < 1e-6) return 0;
    return approximateModifiedBesselI_1(k) / approximateModifiedBesselI_0(k);
  }
  function drawKappaVariancePlot(currentK) {
    if (!kvCtx) return;
    const rect = kappaVarianceCanvas.getBoundingClientRect();
    const w = rect.width || kvCssWidth;
    const h = rect.height || kvCssHeight;
    const margin = 40;
    const plotW = w - 2 * margin;
    const plotH = h - 2 * margin;
    kvCtx.clearRect(0, 0, w, h);
    // Axes
    kvCtx.strokeStyle = '#ddd';
    kvCtx.beginPath();
    kvCtx.moveTo(margin, margin);
    kvCtx.lineTo(margin, h - margin);
    kvCtx.lineTo(w - margin, h - margin);
    kvCtx.stroke();
    // Compute variance values across range
    const maxK = 20;
    const steps = 100;
    let maxVar = 1;
    const vals = [];
    for (let i = 0; i <= steps; i++) {
      const k = (i / steps) * maxK;
      const R = getR(k);
      const v = 1 - R;
      vals.push({ k, v });
      if (v > maxVar) maxVar = v;
    }
    // Draw line
    kvCtx.strokeStyle = '#c0392b';
    kvCtx.lineWidth = 2;
    kvCtx.beginPath();
    vals.forEach((pt, i) => {
      const x = margin + (pt.k / maxK) * plotW;
      const y = h - margin - (pt.v / maxVar) * plotH;
      if (i === 0) kvCtx.moveTo(x, y);
      else kvCtx.lineTo(x, y);
    });
    kvCtx.stroke();
    // Current κ marker
    const currentX = margin + (currentK / maxK) * plotW;
    kvCtx.strokeStyle = '#007acc';
    kvCtx.beginPath();
    kvCtx.moveTo(currentX, margin);
    kvCtx.lineTo(currentX, h - margin);
    kvCtx.stroke();
    // Axis labels
    kvCtx.fillStyle = '#333';
    kvCtx.font = '10px sans-serif';
    kvCtx.textAlign = 'center';
    kvCtx.fillText('κ', margin + plotW / 2, h - 5);
    kvCtx.save();
    kvCtx.translate(15, margin + plotH / 2);
    kvCtx.rotate(-Math.PI / 2);
    kvCtx.fillText('Circular variance', 0, 0);
    kvCtx.restore();
  }

  function updateVarianceReadout(kVal) {
    if (!kappaVarianceReadout) return;
    const variance = 1 - getR(kVal);
    const kText = kVal.toFixed(2);
    const varianceText = variance.toFixed(3);
    if (kappaVarianceValue && kappaVarianceResult) {
      kappaVarianceValue.textContent = kText;
      kappaVarianceResult.textContent = varianceText;
    } else {
      kappaVarianceReadout.textContent = `κ = ${kText}, circular variance ≈ ${varianceText}`;
    }
  }

  // Tooltip and hover interaction for the κ-variance plot.  Displays the
  // value of κ and the corresponding circular variance when the user
  // hovers over the plot.  Also draws a red vertical line at the hover
  // position.
  const varianceTooltip = document.createElement('div');
  varianceTooltip.style.position = 'fixed';
  varianceTooltip.style.pointerEvents = 'none';
  varianceTooltip.style.background = 'rgba(255, 255, 255, 0.95)';
  varianceTooltip.style.border = '1px solid #ddd';
  varianceTooltip.style.borderRadius = '4px';
  varianceTooltip.style.padding = '2px 6px';
  varianceTooltip.style.fontSize = '0.75rem';
  varianceTooltip.style.display = 'none';
  varianceTooltip.style.zIndex = '9999';
  document.body.appendChild(varianceTooltip);
  kappaVarianceCanvas.addEventListener('mousemove', (e) => {
    const rect = kappaVarianceCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width || kvCssWidth;
    const h = rect.height || kvCssHeight;
    const margin = 40;
    const plotW = w - 2 * margin;
    const maxK = 20;
    // Compute κ based on mouse x position
    let kHover = (x - margin) / plotW * maxK;
    if (kHover < 0) kHover = 0;
    if (kHover > maxK) kHover = maxK;
    // Compute circular variance for hover κ
    let rHover;
    if (kHover < 1e-6) rHover = 0;
    else rHover = approximateModifiedBesselI_1(kHover) / approximateModifiedBesselI_0(kHover);
    const varHover = 1 - rHover;
    // Redraw base plot and vertical line for hover
    drawKappaVariancePlot(tourKappaVal);
    kvCtx.strokeStyle = '#e74c3c';
    kvCtx.lineWidth = 1;
    kvCtx.beginPath();
    kvCtx.moveTo(margin + (kHover / maxK) * plotW, margin);
    kvCtx.lineTo(margin + (kHover / maxK) * plotW, h - margin);
    kvCtx.stroke();
    // Update tooltip
    varianceTooltip.style.left = `${e.pageX + 12}px`;
    varianceTooltip.style.top = `${e.pageY + 12}px`;
    varianceTooltip.innerHTML = `κ = ${kHover.toFixed(2)}<br>Var = ${varHover.toFixed(2)}`;
    varianceTooltip.style.display = 'block';
    updateVarianceReadout(kHover);
  });
  kappaVarianceCanvas.addEventListener('mouseleave', () => {
    varianceTooltip.style.display = 'none';
    // Redraw plot with current κ marker only
    drawKappaVariancePlot(tourKappaVal);
    updateVarianceReadout(tourKappaVal);
  });
  // Draw initial variance plot
  drawKappaVariancePlot(tourKappaVal);
  updateVarianceReadout(tourKappaVal);
  // Spinner analogy
  const spinnerCanvas = document.getElementById('spinnerCanvas');
  const spinnerDims = spinnerCanvas ? fixCanvasDPI(spinnerCanvas) : null;
  const spinnerCtx = spinnerCanvas ? spinnerCanvas.getContext('2d') : null;
  let spinnerCssWidth = spinnerDims && spinnerDims.cssWidth ? spinnerDims.cssWidth : 0;
  let spinnerCssHeight = spinnerDims && spinnerDims.cssHeight ? spinnerDims.cssHeight : 0;
  if (spinnerCanvas && (!spinnerCssWidth || !spinnerCssHeight)) {
    const rect = spinnerCanvas.getBoundingClientRect();
    spinnerCssWidth = rect.width;
    spinnerCssHeight = rect.height;
  }
  function drawSpinner(kVal) {
    if (!spinnerCtx) return;
    const rect = spinnerCanvas.getBoundingClientRect();
    const w = rect.width || spinnerCssWidth;
    const h = rect.height || spinnerCssHeight;
    const cx = w / 2;
    const cy = h / 2;
    const baseR = Math.min(w, h) / 2 - 20;
    spinnerCtx.clearRect(0, 0, w, h);
    // Draw circle
    spinnerCtx.strokeStyle = '#dcdfe6';
    spinnerCtx.lineWidth = 2;
    spinnerCtx.beginPath();
    spinnerCtx.arc(cx, cy, baseR, 0, TAU);
    spinnerCtx.stroke();
    // Draw pointer at angle μ=0
    spinnerCtx.strokeStyle = '#007acc';
    spinnerCtx.lineWidth = 3;
    spinnerCtx.beginPath();
    spinnerCtx.moveTo(cx, cy);
    spinnerCtx.lineTo(cx, cy - baseR);
    spinnerCtx.stroke();
    // Draw weight along pointer: size and distance proportional to kappa
    const t = Math.min(kVal / 20, 1);
    const weightR = 6 + 14 * t;
    const offset = 30 + 40 * t;
    const wx = cx;
    const wy = cy - offset;
    spinnerCtx.beginPath();
    spinnerCtx.arc(wx, wy, weightR, 0, TAU);
    spinnerCtx.fillStyle = 'rgba(192, 60, 60, 0.7)';
    spinnerCtx.fill();
  }
  drawSpinner(tourKappaVal);

  // Make the spinner weight draggable.  As the user drags the weight up
  // or down along the pointer, update the κ slider accordingly.  The weight
  // can move between offset 30 (low concentration) and 70 (high concentration).
  let spinnerDragging = false;
  spinnerCanvas.addEventListener('mousedown', (e) => {
    const rect = spinnerCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width || spinnerCssWidth;
    const h = rect.height || spinnerCssHeight;
    const cx = w / 2;
    const cy = h / 2;
    // Compute current weight position based on current kappa
    const kVal = parseFloat(tourKappaSlider.value);
    const t = Math.min(kVal / tourKappaSlider.max, 1);
    const offset = 30 + 40 * t;
    const weightX = cx;
    const weightY = cy - offset;
    const weightR = 6 + 14 * t;
    const dx = x - weightX;
    const dy = y - weightY;
    if (Math.sqrt(dx * dx + dy * dy) <= weightR + 3) {
      spinnerDragging = true;
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!spinnerDragging) return;
    const rect = spinnerCanvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height || spinnerCssHeight;
    const cy = h / 2;
    // Compute new offset relative to center along vertical axis; invert because y increases downward
    let offset = cy - y;
    // Constrain offset between 30 and 70
    if (offset < 30) offset = 30;
    if (offset > 70) offset = 70;
    const t = (offset - 30) / 40;
    // Compute new κ from t: linear interpolation between slider min and max
    const minK = parseFloat(tourKappaSlider.min);
    const maxK = parseFloat(tourKappaSlider.max);
    const newK = minK + t * (maxK - minK);
    tourKappaSlider.value = newK;
    tourKappaLabel.textContent = `κ = ${parseFloat(newK).toFixed(2)}`;
    tourKappaVal = parseFloat(newK);
    tourSamples2 = generateVonMisesSamplesArray(300, 0, tourKappaVal);
    tourPlot2.update(0, tourKappaVal, tourSamples2);
    updateKappaComparisons();
    drawKappaVariancePlot(tourKappaVal);
    updateVarianceReadout(tourKappaVal);
    drawSpinner(tourKappaVal);
  });
  document.addEventListener('mouseup', () => {
    spinnerDragging = false;
  });
  // Step 4: connecting to normal distribution
  const tourCanvas3 = document.getElementById('tourCanvas3');
  const tourLinearCanvas = document.getElementById('tourCanvasLinear');
  const tourPlot3 = new PolarPlot(tourCanvas3, false);
  let tourKappa2Val = 2;
  let tourSamples3 = generateVonMisesSamplesArray(300, 0, tourKappa2Val);
  tourPlot3.update(0, tourKappa2Val, tourSamples3);
  const tourKappa2Slider = document.getElementById('tourKappa2');
  const tourKappa2Label = document.getElementById('tourKappa2Label');
  const overlayNormalCheckbox = document.getElementById('overlayNormal');
  const unrollButton = document.getElementById('unrollButton');
  const approxErrorCanvas = document.getElementById('approxErrorPlot');
  const approxCtx = approxErrorCanvas ? approxErrorCanvas.getContext('2d') : null;
  const approxDims = approxErrorCanvas ? fixCanvasDPI(approxErrorCanvas) : null;
  let approxCssWidth = approxDims && approxDims.cssWidth ? approxDims.cssWidth : 0;
  let approxCssHeight = approxDims && approxDims.cssHeight ? approxDims.cssHeight : 0;
  if (approxErrorCanvas && (!approxCssWidth || !approxCssHeight)) {
    const rect = approxErrorCanvas.getBoundingClientRect();
    approxCssWidth = rect.width;
    approxCssHeight = rect.height;
  }
  if (approxErrorCanvas && (!approxCssWidth || !approxCssHeight)) {
    approxCssWidth = approxErrorCanvas.width;
    approxCssHeight = approxErrorCanvas.height;
  }

  /*
Draw the approximation error plot across a range of κ. The error is
measured as the root mean square difference between the von Mises and
the corresponding normal PDF over the interval [-pi, pi]. A vertical
line marks the current κ value from the slider.
*/
  function drawApproxErrorPlot() {
    if (!approxCtx) return;
    const rect = approxErrorCanvas.getBoundingClientRect();
    const w = rect.width || approxCssWidth || approxErrorCanvas.width;
    const h = rect.height || approxCssHeight || approxErrorCanvas.height;
    const margin = 40;
    const plotW = w - 2 * margin;
    const plotH = h - 2 * margin;
    approxCtx.clearRect(0, 0, w, h);
    // Axes
    approxCtx.strokeStyle = '#ddd';
    approxCtx.beginPath();
    approxCtx.moveTo(margin, margin);
    approxCtx.lineTo(margin, h - margin);
    approxCtx.lineTo(w - margin, h - margin);
    approxCtx.stroke();
    // Precompute error values
    const maxK = 20;
    const steps = 80;
    const errorVals = [];
    let maxErr = 0;
    for (let i = 1; i <= steps; i++) {
      const k = (i / steps) * maxK;
      // Compute RMS error between von Mises and normal approx
      const pts = 200;
      let sumSq = 0;
      let sumVM = 0;
      let sumNorm = 0;
      // Precompute I0 for efficiency
      const b0 = approximateModifiedBesselI_0(k);
      for (let j = 0; j < pts; j++) {
        const x = -Math.PI + (j / pts) * (2 * Math.PI);
        const vm = Math.exp(k * Math.cos(x)) / (2 * Math.PI * b0);
        const sigma = 1 / Math.sqrt(k || 1e-6);
        let normSum = 0;
        const wraps = 3;
        for (let m = -wraps; m <= wraps; m++) {
          const diff = x + m * TAU;
          normSum += Math.exp(-(diff * diff) / (2 * sigma * sigma));
        }
        const norm = normSum / (sigma * Math.sqrt(2 * Math.PI));
        const diffVal = vm - norm;
        sumSq += diffVal * diffVal;
        sumVM += vm;
        sumNorm += norm;
      }
      const mse = sumSq / pts;
      const rmse = Math.sqrt(mse);
      errorVals.push({ k, err: rmse });
      if (rmse > maxErr) maxErr = rmse;
    }
    // Draw error line
    approxCtx.strokeStyle = '#c0392b';
    approxCtx.lineWidth = 2;
    approxCtx.beginPath();
    errorVals.forEach((pt, idx) => {
      const x = margin + (pt.k / maxK) * plotW;
      const y = h - margin - (pt.err / maxErr) * plotH;
      if (idx === 0) approxCtx.moveTo(x, y);
      else approxCtx.lineTo(x, y);
    });
    approxCtx.stroke();
    // Current κ marker
    const currentX = margin + (tourKappa2Val / maxK) * plotW;
    approxCtx.strokeStyle = '#007acc';
    approxCtx.beginPath();
    approxCtx.moveTo(currentX, margin);
    approxCtx.lineTo(currentX, h - margin);
    approxCtx.stroke();
    // Labels
    approxCtx.fillStyle = '#333';
    approxCtx.font = '10px sans-serif';
    approxCtx.textAlign = 'center';
    approxCtx.fillText('κ', margin + plotW / 2, h - 5);
    approxCtx.save();
    approxCtx.translate(15, margin + plotH / 2);
    approxCtx.rotate(-Math.PI / 2);
    approxCtx.fillText('Approximation error', 0, 0);
    approxCtx.restore();
  }
  // Initial error plot
  drawApproxErrorPlot();

  // Overlay normal checkbox listener
  if (overlayNormalCheckbox) {
    overlayNormalCheckbox.addEventListener('change', () => {
      drawLinearPlot();
    });
  }
  // Unroll button listener: toggles a simple animation by temporarily
  // hiding the polar plot and emphasising the linear plot. For a more
  // elaborate animation a CSS transform could be used, but for clarity
  // The button simply toggles a class.
  let unrolled = false;
  if (unrollButton) {
    unrollButton.addEventListener('click', () => {
      unrolled = !unrolled;
      if (unrolled) {
        unrollButton.textContent = 'Roll Back';
        // Hide the circular canvas and emphasize the linear plot
        tourCanvas3.style.opacity = '0.2';
        tourLinearCanvas.style.border = '2px solid var(--accent)';
      } else {
        unrollButton.textContent = 'Unroll';
        tourCanvas3.style.opacity = '1';
        tourLinearCanvas.style.border = 'none';
      }
    });
  }
  // Restart tour button
  const restartBtn = document.getElementById('restartTour');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      showTourStep(0);
    });
  }
  function drawLinearPlot() {
    const ctx = tourLinearCanvas.getContext('2d');
    ctx.clearRect(0, 0, tourLinearCanvas.width, tourLinearCanvas.height);
    // Draw axes
    const width = tourLinearCanvas.width;
    const height = tourLinearCanvas.height;
    const margin = 40;
    const plotWidth = width - 2 * margin;
    const plotHeight = height - 2 * margin;
    // Draw axis lines
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(margin, margin);
    ctx.lineTo(margin, height - margin);
    ctx.lineTo(width - margin, height - margin);
    ctx.stroke();
    // Compute pdf on linear scale by unwrapping onto [-pi, pi]
    const steps = 200;
    let maxDensity = 0;
    const densities = [];
    for (let i = 0; i <= steps; i++) {
      const x = -Math.PI + (i / steps) * (2 * Math.PI);
      const d = computeVonMisesPdf(x, 0, tourKappa2Val);
      densities.push(d);
      if (d > maxDensity) maxDensity = d;
    }
    // Draw von Mises line
    ctx.strokeStyle = '#007acc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = -Math.PI + (i / steps) * (2 * Math.PI);
      const px = margin + ((x + Math.PI) / (2 * Math.PI)) * plotWidth;
      const py = height - margin - (densities[i] / maxDensity) * plotHeight;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Optionally overlay a normal PDF when the user checks the box. A normal distribution with mean 0 and variance 1/κ is a good approximation for large κ.
    if (overlayNormalCheckbox && overlayNormalCheckbox.checked) {
      // Compute normal pdf on [-pi, pi]
      const sigma = 1 / Math.sqrt(tourKappa2Val || 1e-6);
      const normDensities = [];
      let maxNorm = 0;
      for (let i = 0; i <= steps; i++) {
        const x = -Math.PI + (i / steps) * (2 * Math.PI);
        let sum = 0;
        // Wrap normal by summing a few periods
        const wraps = 3;
        for (let k = -wraps; k <= wraps; k++) {
          const diff = x + k * TAU;
          sum += Math.exp(-(diff * diff) / (2 * sigma * sigma));
        }
        const dn = sum / (sigma * Math.sqrt(2 * Math.PI));
        normDensities.push(dn);
        if (dn > maxNorm) maxNorm = dn;
      }
      // Normalize scaling relative to von Mises max so they share the same height
      const scale = maxDensity > 0 ? maxDensity : 1;
      ctx.strokeStyle = '#e67e22';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = -Math.PI + (i / steps) * (2 * Math.PI);
        const px = margin + ((x + Math.PI) / (2 * Math.PI)) * plotWidth;
        const py = height - margin - (normDensities[i] / maxNorm) * plotHeight;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // Axis labels
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('θ (radians)', margin + plotWidth / 2, height - 10);
    ctx.save();
    ctx.translate(15, margin + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Density', 0, 0);
    ctx.restore();
  }
  // Initial draw
  drawLinearPlot();
  tourKappa2Slider.addEventListener('input', () => {
    tourKappa2Val = parseFloat(tourKappa2Slider.value);
    tourKappa2Label.textContent = `κ = ${tourKappa2Val.toFixed(1)}`;
    tourSamples3 = generateVonMisesSamplesArray(300, 0, tourKappa2Val);
    tourPlot3.update(0, tourKappa2Val, tourSamples3);
    drawLinearPlot();
    drawApproxErrorPlot();
  });

  /* Module 3: expert exploration */
  // Distribution comparison
  const compCanvas = document.getElementById('comparisonCanvas');
  const compPlot = new PolarPlot(compCanvas, false);
  const compMuSlider = document.getElementById('compMuSlider');
  const compMuInput = document.getElementById('compMuInput');
  const compKappaSlider = document.getElementById('compKappaSlider');
  const compKappaInput = document.getElementById('compKappaInput');
  const compDistType = document.getElementById('compDistType');
  const compParamsDiv = document.getElementById('compParams');
  const compSummary = document.getElementById('compSummary');

  let compMuDeg = parseFloat(compMuSlider.value);
  let compMu = degToRad(compMuDeg);
  let compKappa = parseFloat(compKappaSlider.value);
  let compSamples = generateVonMisesSamplesArray(400, compMu, compKappa);

  const compSecondary = {
    type: compDistType.value,
    muDeg: compMuDeg,
    mu: compMu,
    params: {},
    muLocked: true
  };

  function regenerateBaseSamples() {
    compSamples = generateVonMisesSamplesArray(400, compMu, compKappa);
  }

  function updateComparisonSummary() {
    if (!compSummary) return;
    const baseText = `Baseline: μ = ${compMuDeg.toFixed(1)}°, κ = ${compKappa.toFixed(2)}`;
    if (compSecondary.type === 'none') {
      compSummary.textContent = `${baseText}. No overlay selected.`;
      return;
    }
    let overlayText = '';
    if (compSecondary.type === 'wrappedNormal') {
      const sigma = compSecondary.params.sigma ?? 1;
      overlayText = `Wrapped Normal with μ = ${compSecondary.muDeg.toFixed(1)}°, σ = ${sigma.toFixed(2)}`;
    } else if (compSecondary.type === 'cardioid') {
      const rho = compSecondary.params.rho ?? 0;
      overlayText = `Cardioid with μ = ${compSecondary.muDeg.toFixed(1)}°, ρ = ${rho.toFixed(2)}`;
    }
    compSummary.textContent = `${baseText}. Overlay: ${overlayText}.`;
  }

  function drawComparison() {
    compPlot.update(compMu, compKappa, compSamples);
    const ctx = compCanvas.getContext('2d');
    ctx.save();
    ctx.translate(compPlot.centerX, compPlot.centerY);

    const steps = 360;
    let maxDensity = 0;
    const baseDensities = [];
    const secondaryDensities = [];
    const overlayActive = compSecondary.type !== 'none';
    const overlayMu = overlayActive ? compSecondary.mu : compMu;

    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * TAU;
      const baseVal = computeVonMisesPdf(ang, compMu, compKappa);
      baseDensities.push(baseVal);
      if (baseVal > maxDensity) maxDensity = baseVal;

      let overlayVal = 0;
      if (overlayActive) {
        if (compSecondary.type === 'wrappedNormal') {
          const sigma = compSecondary.params.sigma ?? 1;
          overlayVal = wrappedNormalPDF(ang, overlayMu, sigma);
        } else if (compSecondary.type === 'cardioid') {
          const rho = compSecondary.params.rho ?? 0;
          overlayVal = Math.max(0, cardioidPDF(ang, overlayMu, rho));
        }
      }
      secondaryDensities.push(overlayVal);
      if (overlayVal > maxDensity) maxDensity = overlayVal;
    }

    const scale = maxDensity > 0 ? (compPlot.radius * 0.8) / maxDensity : 0;

    if (overlayActive) {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const idx = i % steps;
        const ang = (idx / steps) * TAU;
        const r = secondaryDensities[idx] * scale;
        const x = r * Math.cos(ang);
        const y = r * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#27ae60';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
    updateComparisonSummary();
  }

  function setBaseMu(newDeg) {
    if (Number.isNaN(newDeg)) return;
    const wrapped = ((newDeg % 360) + 360) % 360;
    compMuDeg = wrapped;
    compMu = degToRad(compMuDeg);
    compMuSlider.value = compMuDeg;
    compMuInput.value = compMuDeg;
    regenerateBaseSamples();
    if (compSecondary.type !== 'none' && compSecondary.muLocked) {
      compSecondary.muDeg = compMuDeg;
      compSecondary.mu = compMu;
    }
    drawComparison();
  }

  function setBaseKappa(newVal) {
    if (Number.isNaN(newVal)) return;
    const clamped = Math.min(20, Math.max(0.01, newVal));
    compKappa = clamped;
    compKappaSlider.value = compKappa;
    compKappaInput.value = compKappa.toFixed(2);
    regenerateBaseSamples();
    drawComparison();
  }

  compMuSlider.addEventListener('input', () => {
    setBaseMu(parseFloat(compMuSlider.value));
  });
  compMuInput.addEventListener('input', () => {
    setBaseMu(parseFloat(compMuInput.value));
  });
  compKappaSlider.addEventListener('input', () => {
    setBaseKappa(parseFloat(compKappaSlider.value));
  });
  compKappaInput.addEventListener('input', () => {
    setBaseKappa(parseFloat(compKappaInput.value));
  });

  function createParamGroup({ label, min, max, step, value, onChange, wrap = false }) {
    const group = document.createElement('div');
    group.className = 'comp-param-group';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);

    const number = document.createElement('input');
    number.type = 'number';
    number.min = String(min);
    number.max = String(max);
    number.step = String(step);
    number.value = String(value);

    const applyValue = (raw) => {
      let val = parseFloat(raw);
      if (Number.isNaN(val)) return;
      if (wrap) {
        val = ((val % max) + max) % max;
      } else {
        val = Math.min(max, Math.max(min, val));
      }
      slider.value = String(val);
      number.value = String(val);
      onChange(val);
      drawComparison();
    };

    slider.addEventListener('input', () => applyValue(slider.value));
    number.addEventListener('input', () => applyValue(number.value));

    group.appendChild(labelEl);
    group.appendChild(slider);
    group.appendChild(number);
    return group;
  }

  function buildSecondaryControls() {
    compSecondary.type = compDistType.value;
    compParamsDiv.innerHTML = '';
    compSecondary.params = {};
    compSecondary.muLocked = true;

    if (compSecondary.type === 'none') {
      compSecondary.muDeg = compMuDeg;
      compSecondary.mu = compMu;
      updateComparisonSummary();
      drawComparison();
      return;
    }

    compSecondary.muDeg = compMuDeg;
    compSecondary.mu = compMu;

    const muGroup = createParamGroup({
      label: 'μ (degrees)',
      min: 0,
      max: 360,
      step: 1,
      value: compSecondary.muDeg,
      wrap: true,
      onChange: (deg) => {
        compSecondary.muDeg = deg;
        compSecondary.mu = degToRad(deg);
        compSecondary.muLocked = false;
      }
    });
    compParamsDiv.appendChild(muGroup);

    if (compSecondary.type === 'wrappedNormal') {
      compSecondary.params.sigma = 0.8;
      const sigmaGroup = createParamGroup({
        label: 'σ (spread)',
        min: 0.05,
        max: 3,
        step: 0.01,
        value: compSecondary.params.sigma,
        onChange: (val) => {
          compSecondary.params.sigma = val;
        }
      });
      compParamsDiv.appendChild(sigmaGroup);
    } else if (compSecondary.type === 'cardioid') {
      compSecondary.params.rho = 0.1;
      const rhoGroup = createParamGroup({
        label: 'ρ (shape)',
        min: -0.49,
        max: 0.49,
        step: 0.01,
        value: compSecondary.params.rho,
        onChange: (val) => {
          compSecondary.params.rho = val;
        }
      });
      compParamsDiv.appendChild(rhoGroup);
    }

    updateComparisonSummary();
    drawComparison();
  }

  compDistType.addEventListener('change', () => {
    buildSecondaryControls();
  });

  buildSecondaryControls();
  updateComparisonSummary();
  drawComparison();

  // Parameter estimation sandbox
  const dataInput = document.getElementById('dataInput');
  const dataUnits = document.getElementById('dataUnits');
  const estimateBtn = document.getElementById('estimateBtn');
  const estimationResults = document.getElementById('estimationResults');
  const estMuSpan = document.getElementById('estMu');
  const estKappaSpan = document.getElementById('estKappa');
  const estimationCanvas = document.getElementById('estimationCanvas');
  const estPlot = new PolarPlot(estimationCanvas, false);
  estimateBtn.addEventListener('click', () => {
    const text = dataInput.value.trim();
    if (text === '') return;
    // Parse comma or whitespace separated numbers. Using a regular
    // expression ensures that both comma‑separated and space‑separated
    // data are accepted. Non‑numeric entries are ignored to make the
    // tool robust to accidental typos.
    const parts = text.split(/[,\s]+/);
    const values = [];
    for (const p of parts) {
      const v = parseFloat(p);
      if (!isNaN(v)) values.push(v);
    }
    if (values.length === 0) return;
    // Convert to radians if necessary. The unit selector uses
    // lowercase values ("degrees" or "radians"). If degrees are
    // selected each number is converted; otherwise the input is
    // assumed to already be in radians.
    const isDegrees = dataUnits.value === 'degrees';
    const angles = values.map((val) => (isDegrees ? degToRad(val) : val));
    const { mu: estMu, kappa: estKappa } = estimateMuKappa(angles);
    // Update the displayed estimates. Converting μ back to degrees
    // provides an intuitive output for most users.
    estMuSpan.textContent = `${radToDeg(estMu).toFixed(2)}°`;
    estKappaSpan.textContent = estKappa.toFixed(3);
    // Show the results panel explicitly in case the 'hidden'
    // attribute persists. Both hidden and display styles are managed.
    estimationResults.hidden = false;
    estimationResults.style.display = 'block';
    // Draw the histogram and fitted PDF. We reuse the original
    // angles as samples; the PolarPlot will overlay the von Mises
    // PDF using the estimated parameters.
    const fittedSamples = angles;
    estPlot.update(estMu, estKappa, fittedSamples);
  });

  // Real‑world dataset loader
  const datasetSelect = document.getElementById('datasetSelect');
  const loadDatasetBtn = document.getElementById('loadDataset');
  const datasetDesc = document.getElementById('datasetDescription');
  const datasetResults = document.getElementById('datasetResults');
  const dsMuSpan = document.getElementById('dsMu');
  const dsKappaSpan = document.getElementById('dsKappa');
  const datasetCanvas = document.getElementById('datasetCanvas');
  const dsPlot = new PolarPlot(datasetCanvas, false);
  // Preloaded datasets (synthetic examples). These arrays should be replaced
  // with real data when available, but they still illustrate the mechanics.
  const datasets = {
    turtles: {
      desc:
        'Orientation angles (degrees) recorded from migrating turtles. These data are adapted from Fisher (1993) and show a cluster near 100°. Values: 76, 91, 97, 99, 103, 104, 112, 121, 132, 139.',
      data: [76, 91, 97, 99, 103, 104, 112, 121, 132, 139]
    },
    hospital: {
      desc:
        'Times of hospital admissions (degrees) for a specific condition mapped onto 0–360°. Clustering around early morning and evening.',
      data: [
        30, 45, 60, 75, 80, 350, 10, 20, 90, 100, 110, 250, 260, 270, 280, 290, 295,
        300, 310, 320
      ]
    },
    wind: {
      desc:
        'Wind direction measurements (degrees) at a coastal station over several days.',
      data: [
        20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300,
        320, 340, 360, 10, 25
      ]
    },
    custom: {
      desc:
        'Custom synthetic data illustrating a bimodal pattern.',
      data: [
        0, 10, 20, 30, 40, 50, 180, 190, 200, 210, 220, 230, 240, 250, 260
      ]
    }
  };
  loadDatasetBtn.addEventListener('click', () => {
    const key = datasetSelect.value;
    if (!datasets[key]) return;
    const ds = datasets[key];
    datasetDesc.textContent = ds.desc;
    const angles = ds.data.map((d) => degToRad(d));
    const { mu, kappa: estKappa } = estimateMuKappa(angles);
    dsMuSpan.textContent = `${radToDeg(mu).toFixed(2)}°`;
    dsKappaSpan.textContent = estKappa.toFixed(3);
    datasetResults.hidden = false;
    dsPlot.update(mu, estKappa, angles);
  });

  /* Module 4: knowledge assessment */
  // Guess the parameters
  const guessCanvas = document.getElementById('guessCanvas');
  const guessPlot = new PolarPlot(guessCanvas, false);
  guessPlot.setReferenceAngles([0]);
  let targetMu, targetKappa, guessSamples;
  let guessOverlayActive = false;
  function generateGuessChallenge() {
    // Random μ between 0 and 2pi
    targetMu = Math.random() * TAU;
    // Random κ across ranges: choose from {0.1, 1, 5, 10, 20}
    const kappaChoices = [0.1, 1, 5, 10, 20];
    targetKappa = kappaChoices[Math.floor(Math.random() * kappaChoices.length)];
    guessSamples = generateVonMisesSamplesArray(400, targetMu, targetKappa);
    guessPlot.update(targetMu, targetKappa, guessSamples);
    guessOverlayActive = false;
    guessPlot.clearOverlays();
    // Reset controls
    document.getElementById('guessMuSlider').value = 0;
    document.getElementById('guessMuInput').value = formatOneDecimal(0);
    document.getElementById('guessKappaSlider').value = 1;
    document.getElementById('guessKappaInput').value = formatOneDecimal(1);
    const feedback = document.getElementById('guessFeedback');
    feedback.innerHTML = '';
    feedback.className = 'feedback';
  }
  document.getElementById('generateGuess').addEventListener('click', generateGuessChallenge);
  // Synchronise guess controls
  const guessMuSlider = document.getElementById('guessMuSlider');
  const guessMuInput = document.getElementById('guessMuInput');
  const guessKappaSlider = document.getElementById('guessKappaSlider');
  const guessKappaInput = document.getElementById('guessKappaInput');
  let guessMuVal = 0;
  let guessKappaVal = 1;

  function formatOneDecimal(value) {
    const truncated = Math.trunc(value * 10) / 10;
    return truncated.toFixed(1);
  }
  function syncGuessOverlay() {
    if (!guessOverlayActive) return;
    guessPlot.setOverlays([
      {
        kind: 'vonmises',
        mu: degToRad(guessMuVal),
        kappa: guessKappaVal,
        color: '#e67e22',
        alpha: 0.6,
        lineDash: [6, 4]
      }
    ]);
  }
  function updateGuessMu(val) {
    guessMuVal = ((val % 360) + 360) % 360;
    guessMuSlider.value = guessMuVal;
    guessMuInput.value = formatOneDecimal(guessMuVal);
    syncGuessOverlay();
  }
  function updateGuessKappa(val) {
    guessKappaVal = Math.max(0.01, Math.min(parseFloat(val), 30));
    guessKappaSlider.value = guessKappaVal;
    guessKappaInput.value = formatOneDecimal(guessKappaVal);
    syncGuessOverlay();
  }
  guessMuSlider.addEventListener('input', (e) => updateGuessMu(parseFloat(e.target.value)));
  guessMuInput.addEventListener('input', (e) => updateGuessMu(parseFloat(e.target.value)));
  guessKappaSlider.addEventListener('input', (e) => updateGuessKappa(e.target.value));
  guessKappaInput.addEventListener('input', (e) => updateGuessKappa(e.target.value));
  // Check guess button
  document.getElementById('checkGuess').addEventListener('click', () => {
    if (targetMu === undefined) return;
    // Compute differences
    const muDiff = Math.abs(radToDeg(wrapAngleToZeroToTwoPi(degToRad(guessMuVal) - targetMu)));
    // Choose the smaller angle difference mod 360
    const circDiff = muDiff > 180 ? 360 - muDiff : muDiff;
    const kappaDiff = Math.abs(guessKappaVal - targetKappa);
    let score = 100 - (circDiff * 0.5 + kappaDiff * 5);
    score = Math.max(0, Math.round(score));
    const feedback = document.getElementById('guessFeedback');
    const trueMuDeg = radToDeg(targetMu);
    feedback.innerHTML = `
      <div class="guess-feedback">
        <p><strong>Score:</strong> ${score}/100</p>
        <p><strong>True parameters:</strong> μ = ${trueMuDeg.toFixed(1)}°, κ = ${targetKappa.toFixed(2)}</p>
        <p><strong>Your guess:</strong> μ = ${guessMuVal.toFixed(1)}°, κ = ${guessKappaVal.toFixed(2)}</p>
        <p><strong>Error:</strong> μ difference ${circDiff.toFixed(1)}°, κ difference ${kappaDiff.toFixed(2)}</p>
      </div>
    `;
    feedback.className = 'feedback';
    guessOverlayActive = true;
    guessPlot.setOverlays([
      {
        kind: 'vonmises',
        mu: degToRad(guessMuVal),
        kappa: guessKappaVal,
        color: '#e67e22',
        alpha: 0.6,
        lineDash: [6, 4]
      }
    ]);
    // Mark progress as complete if the score is sufficiently high (≥ 80)
    if (score >= 80) {
      markComplete('guess');
    }
  });
  // Initialize first challenge
  generateGuessChallenge();

  // Identify the distribution
  const identifyCanvas = document.getElementById('identifyCanvas');
  const identifyPlot = new PolarPlot(identifyCanvas, false);
  let identifySamples;
  let identifyTrueType;
  function generateIdentifySample() {
    // Randomly pick a distribution
    const types = ['vonmises', 'wrappedNormal', 'uniform', 'wrappedCauchy', 'cardioid', 'bimodal'];
    identifyTrueType = types[Math.floor(Math.random() * types.length)];
    const mu0 = Math.random() * TAU;
    let k0 = 1;
    let sigma0 = 0.5;
    if (identifyTrueType === 'vonmises') {
      const kChoices = [0.5, 2, 8];
      k0 = kChoices[Math.floor(Math.random() * kChoices.length)];
      identifySamples = generateVonMisesSamplesArray(400, mu0, k0);
      identifyPlot.update(mu0, k0, identifySamples);
    } else if (identifyTrueType === 'wrappedNormal') {
      // Sigma choices
      const sChoices = [0.3, 0.6, 1.0];
      sigma0 = sChoices[Math.floor(Math.random() * sChoices.length)];
      // Sampling the wrapped normal uses a normal draw followed by wrapping
      identifySamples = [];
      for (let i = 0; i < 400; i++) {
        // Box–Muller transform
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const val = mu0 + z * sigma0;
        identifySamples.push(wrapAngleToZeroToTwoPi(val));
      }
      identifyPlot.update(mu0, 1, identifySamples);
    } else if (identifyTrueType === 'uniform') {
      // Uniform distribution
      identifySamples = [];
      for (let i = 0; i < 400; i++) {
        identifySamples.push(Math.random() * TAU);
      }
      identifyPlot.update(0, 0, identifySamples);
    } else if (identifyTrueType === 'wrappedCauchy') {
      // Wrapped Cauchy distribution with parameter rho
      const rhoChoices = [0.2, 0.5, 0.8];
      const rho = rhoChoices[Math.floor(Math.random() * rhoChoices.length)];
      identifySamples = [];
      for (let i = 0; i < 400; i++) {
        const u = Math.random();
        const angle = mu0 + 2 * Math.atan(((1 + rho) / (1 - rho)) * Math.tan(Math.PI * (u - 0.5)));
        identifySamples.push(wrapAngleToZeroToTwoPi(angle));
      }
      identifyPlot.update(mu0, 1, identifySamples);
    } else if (identifyTrueType === 'cardioid') {
      const rhoChoices = [0.1, 0.25, 0.45];
      const rho = rhoChoices[Math.floor(Math.random() * rhoChoices.length)];
      identifySamples = [];
      for (let i = 0; i < 400; i++) {
        let theta;
        do {
          theta = Math.random() * TAU;
        } while (Math.random() > (1 + 2 * rho * Math.cos(theta - mu0)) / (1 + 2 * rho));
        identifySamples.push(theta);
      }
      identifyPlot.update(mu0, 1, identifySamples);
    } else if (identifyTrueType === 'bimodal') {
      const kA = 4 + Math.random() * 4;
      const kB = 4 + Math.random() * 4;
      const muA = mu0;
      const muB = wrapAngleToZeroToTwoPi(mu0 + Math.PI + (Math.random() - 0.5) * (Math.PI / 6));
      const half = 200;
      const sA = generateVonMisesSamplesArray(half, muA, kA);
      const sB = generateVonMisesSamplesArray(400 - half, muB, kB);
      identifySamples = sA.concat(sB);
      identifyPlot.update(mu0, Math.max(kA, kB), identifySamples);
    }
    // Clear feedback and radio buttons
    document.getElementById('identifyFeedback').textContent = '';
    const radios = document.querySelectorAll('input[name="identifyDist"]');
    radios.forEach((r) => (r.checked = false));
  }
  document.getElementById('generateIdentify').addEventListener('click', generateIdentifySample);
  // Check identify answer
  document.getElementById('checkIdentify').addEventListener('click', () => {
    const radios = document.querySelectorAll('input[name="identifyDist"]');
    let selected = null;
    radios.forEach((r) => {
      if (r.checked) selected = r.value;
    });
    if (!selected) return;
    const feedback = document.getElementById('identifyFeedback');
    if (selected === identifyTrueType) {
      feedback.textContent = 'Correct!';
      feedback.className = 'feedback success';
    } else {
      feedback.textContent = `Incorrect. The true distribution was ${identifyTrueType}.`;
      feedback.className = 'feedback error';
    }
  });
  // Generate initial identify sample
  generateIdentifySample();

  /* Module 4: extended knowledge assessment */
  // Progress tracking object and helper
  const assessmentProgress = {
    guess: false,
    identify: false,
    outlier: false,
    bimodal: false,
    hypothesis: false,
    scenario: false,
    estimation: false,
    effectn: false,
    proof: false,
    ranking: false,
  };
  function markComplete(mode) {
    if (!assessmentProgress[mode]) {
      assessmentProgress[mode] = true;
      const item = document.querySelector(`#assessmentProgress .progress-item[data-mode="${mode}"]`);
      if (item) item.classList.add('complete');
    }
  }

  /* ---- Outlier Detection ---- */
  const outlierCanvas = document.getElementById('outlierCanvas');
  const outlierPlot = new PolarPlot(outlierCanvas, false);
  outlierPlot.setReferenceAngles([0]);
  let outlierSamples = [];
  let outlierBaseMu = 0;
  let outlierBaseK = 4;
  let selectedOutliers = new Set();
  let lastTrueOutliers = new Set();
  let revealOutliers = false;
  function renderOutlierSelections() {
    const ctx = outlierCanvas.getContext('2d');
    ctx.save();
    ctx.translate(outlierPlot.centerX, outlierPlot.centerY);
    const baseR = outlierPlot.radius * 0.8;
    selectedOutliers.forEach((idx) => {
      const theta = outlierSamples[idx];
      const x = baseR * Math.cos(theta);
      const y = baseR * Math.sin(theta);
      ctx.beginPath();
      const isTrue = revealOutliers && lastTrueOutliers.has(idx);
      ctx.fillStyle = isTrue ? 'rgba(39, 174, 96, 0.85)' : 'rgba(231, 76, 60, 0.85)';
      ctx.arc(x, y, 5, 0, TAU);
      ctx.fill();
    });
    if (revealOutliers) {
      lastTrueOutliers.forEach((idx) => {
        if (selectedOutliers.has(idx)) return;
        const theta = outlierSamples[idx];
        const x = baseR * Math.cos(theta);
        const y = baseR * Math.sin(theta);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(243, 156, 18, 0.9)';
        ctx.lineWidth = 2;
        ctx.arc(x, y, 6, 0, TAU);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  function generateOutlierSample() {
    // Random base parameters
    const mu0 = Math.random() * TAU;
    const k0 = 4;
    const n = 200;
    outlierSamples = generateVonMisesSamplesArray(n, mu0, k0);
    // Create 2–3 outliers opposite the main cluster
    const numOut = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numOut; i++) {
      const theta = wrapAngleToZeroToTwoPi(mu0 + Math.PI + (Math.random() - 0.5) * 0.5);
      outlierSamples.push(theta);
    }
    // Shuffle samples to avoid grouping
    outlierSamples = outlierSamples.sort(() => Math.random() - 0.5);
    // Clear selected set and draw
    selectedOutliers.clear();
    lastTrueOutliers = new Set();
    revealOutliers = false;
    outlierBaseMu = mu0;
    outlierBaseK = k0;
    outlierPlot.update(outlierBaseMu, outlierBaseK, outlierSamples);
    renderOutlierSelections();
    const fb = document.getElementById('outlierFeedback');
    if (fb) {
      fb.textContent = '';
      fb.className = 'feedback';
    }
  }
  document.getElementById('generateOutlier').addEventListener('click', generateOutlierSample);
  // Select outliers by clicking nearest point
  outlierCanvas.addEventListener('click', (e) => {
    const rect = outlierCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Convert to angle and radius
    const dx = x - outlierPlot.centerX;
    const dy = y - outlierPlot.centerY;
    const clickAngle = wrapAngleToZeroToTwoPi(Math.atan2(dy, dx));
    // Find nearest sample in angle space
    let minIdx = -1;
    let minDiff = Infinity;
    outlierSamples.forEach((theta, idx) => {
      const diff = Math.min(Math.abs(theta - clickAngle), TAU - Math.abs(theta - clickAngle));
      if (diff < minDiff) {
        minDiff = diff;
        minIdx = idx;
      }
    });
    if (minIdx >= 0) {
      if (selectedOutliers.has(minIdx)) {
        selectedOutliers.delete(minIdx);
      } else {
        selectedOutliers.add(minIdx);
      }
    }
    revealOutliers = false;
    outlierPlot.update(outlierBaseMu, outlierBaseK, outlierSamples);
    renderOutlierSelections();
  });
  document.getElementById('checkOutlier').addEventListener('click', () => {
    // Compute statistics to determine cluster centre and dispersion
    const stats = computeCircularStatistics(outlierSamples);
    const mu = stats.mean;
    // Use a concentration‑dependent threshold: broader samples use a larger threshold
    const threshold = stats.R < 0.5 ? (Math.PI / 1.5) : (Math.PI / 3);
    const trueOutliers = new Set();
    outlierSamples.forEach((theta, idx) => {
      const diff = Math.min(Math.abs(theta - mu), TAU - Math.abs(theta - mu));
      if (diff > threshold) trueOutliers.add(idx);
    });
    let correctCount = 0;
    let missedCount = 0;
    let falseCount = 0;
    trueOutliers.forEach((idx) => {
      if (selectedOutliers.has(idx)) {
        correctCount++;
      } else {
        missedCount++;
      }
    });
    selectedOutliers.forEach((idx) => {
      if (!trueOutliers.has(idx)) {
        falseCount++;
      }
    });
    const fb = document.getElementById('outlierFeedback');
    if (correctCount === trueOutliers.size && falseCount === 0) {
      fb.innerHTML = `
        <div class="outlier-feedback">
          <p><strong>Excellent!</strong> You correctly identified all ${trueOutliers.size} outlier(s).</p>
          <p>Threshold ≈ ${radToDeg(threshold).toFixed(0)}° from the mean direction.</p>
        </div>`;
      fb.className = 'feedback success';
      markComplete('outlier');
    } else {
      fb.innerHTML = `
        <div class="outlier-feedback">
          <p><strong>You correctly identified ${correctCount} of ${trueOutliers.size} true outlier(s).</strong></p>
          <p>Missed: ${missedCount} &nbsp;|&nbsp; False positives: ${falseCount}</p>
          <p>Threshold ≈ ${radToDeg(threshold).toFixed(0)}° from the mean direction.</p>
        </div>`;
      fb.className = 'feedback error';
    }
    lastTrueOutliers = trueOutliers;
    revealOutliers = true;
    outlierPlot.update(outlierBaseMu, outlierBaseK, outlierSamples);
    renderOutlierSelections();
  });
  // Generate initial outlier sample
  generateOutlierSample();

  /* ---- Bimodal Fit Challenge ---- */
  const bimodalCanvas = document.getElementById('bimodalCanvas');
  const bimodalPlot = new PolarPlot(bimodalCanvas, false);
  const fitMu1Slider = document.getElementById('fitMu1Slider');
  const fitMu1Input = document.getElementById('fitMu1Input');
  const fitMu2Slider = document.getElementById('fitMu2Slider');
  const fitMu2Input = document.getElementById('fitMu2Input');
  const fitKappa1Slider = document.getElementById('fitKappa1Slider');
  const fitKappa1Input = document.getElementById('fitKappa1Input');
  const fitKappa2Slider = document.getElementById('fitKappa2Slider');
  const fitKappa2Input = document.getElementById('fitKappa2Input');
  const bimodalFeedbackEl = document.getElementById('bimodalFeedback');

  const bimodalGuess = {
    mu1: parseFloat(fitMu1Slider.value),
    mu2: parseFloat(fitMu2Slider.value),
    k1: parseFloat(fitKappa1Slider.value),
    k2: parseFloat(fitKappa2Slider.value)
  };
  let bimodalTrue = {};

  function updateBimodalOverlay() {
    bimodalPlot.setOverlays([
      {
        kind: 'vonmises',
        mu: degToRad(bimodalGuess.mu1),
        kappa: bimodalGuess.k1,
        color: '#e67e22',
        alpha: 0.6,
        lineDash: [6, 4]
      },
      {
        kind: 'vonmises',
        mu: degToRad(bimodalGuess.mu2),
        kappa: bimodalGuess.k2,
        color: '#8e44ad',
        alpha: 0.6,
        lineDash: [4, 4]
      }
    ]);
  }

  function setMu(which, value) {
    if (Number.isNaN(value)) return;
    const wrapped = ((value % 360) + 360) % 360;
    if (which === 1) {
      bimodalGuess.mu1 = wrapped;
      fitMu1Slider.value = wrapped;
      fitMu1Input.value = wrapped.toFixed(1);
    } else {
      bimodalGuess.mu2 = wrapped;
      fitMu2Slider.value = wrapped;
      fitMu2Input.value = wrapped.toFixed(1);
    }
    updateBimodalOverlay();
  }

  function setKappa(which, value) {
    if (Number.isNaN(value)) return;
    const clamped = Math.max(0.1, Math.min(20, value));
    if (which === 1) {
      bimodalGuess.k1 = clamped;
      fitKappa1Slider.value = clamped;
      fitKappa1Input.value = clamped.toFixed(2);
    } else {
      bimodalGuess.k2 = clamped;
      fitKappa2Slider.value = clamped;
      fitKappa2Input.value = clamped.toFixed(2);
    }
    updateBimodalOverlay();
  }

  fitMu1Slider.addEventListener('input', () => setMu(1, parseFloat(fitMu1Slider.value)));
  fitMu1Input.addEventListener('input', () => setMu(1, parseFloat(fitMu1Input.value)));
  fitMu2Slider.addEventListener('input', () => setMu(2, parseFloat(fitMu2Slider.value)));
  fitMu2Input.addEventListener('input', () => setMu(2, parseFloat(fitMu2Input.value)));
  fitKappa1Slider.addEventListener('input', () => setKappa(1, parseFloat(fitKappa1Slider.value)));
  fitKappa1Input.addEventListener('input', () => setKappa(1, parseFloat(fitKappa1Input.value)));
  fitKappa2Slider.addEventListener('input', () => setKappa(2, parseFloat(fitKappa2Slider.value)));
  fitKappa2Input.addEventListener('input', () => setKappa(2, parseFloat(fitKappa2Input.value)));

  function resetBimodalFeedback() {
    bimodalFeedbackEl.textContent = '';
    bimodalFeedbackEl.className = 'feedback';
  }

  function generateBimodalSample() {
    // Randomly choose two means separated by at least 90°
    const mu1 = Math.random() * TAU;
    let mu2 = mu1 + (Math.random() * Math.PI + Math.PI / 2);
    mu2 = wrapAngleToZeroToTwoPi(mu2);
    const k1 = 1 + Math.random() * 8;
    const k2 = 1 + Math.random() * 8;
    const n = 300;
    const half = Math.floor(n / 2);
    const s1 = generateVonMisesSamplesArray(half, mu1, k1);
    const s2 = generateVonMisesSamplesArray(n - half, mu2, k2);
    const all = s1.concat(s2);
    bimodalPlot.update(mu1, k1, all);
    bimodalTrue = { mu1: radToDeg(mu1), mu2: radToDeg(mu2), k1, k2 };
    setMu(1, bimodalTrue.mu1);
    setMu(2, bimodalTrue.mu2);
    setKappa(1, bimodalTrue.k1);
    setKappa(2, bimodalTrue.k2);
    resetBimodalFeedback();
  }

  document.getElementById('generateBimodal').addEventListener('click', generateBimodalSample);
  document.getElementById('checkBimodal').addEventListener('click', () => {
    const mu1Guess = bimodalGuess.mu1;
    const mu2Guess = bimodalGuess.mu2;
    const k1Guess = bimodalGuess.k1;
    const k2Guess = bimodalGuess.k2;
    // Compute smallest differences between guessed and true means (order‑invariant)
    const trueM = [bimodalTrue.mu1, bimodalTrue.mu2];
    const guessM = [mu1Guess, mu2Guess];
    function circDist(a, b) {
      const diff = Math.abs(a - b);
      return Math.min(diff, 360 - diff);
    }
    const pairing1 = circDist(trueM[0], guessM[0]) + circDist(trueM[1], guessM[1]);
    const pairing2 = circDist(trueM[0], guessM[1]) + circDist(trueM[1], guessM[0]);
    const muError = Math.min(pairing1, pairing2) / 2;
    const kError = Math.abs(bimodalTrue.k1 - k1Guess) + Math.abs(bimodalTrue.k2 - k2Guess);
    if (muError < 20 && kError < 5) {
      bimodalFeedbackEl.textContent = `Good job! μ error ~${muError.toFixed(1)}°, κ error total ${kError.toFixed(2)}.`;
      bimodalFeedbackEl.className = 'feedback success';
      markComplete('bimodal');
    } else {
      bimodalFeedbackEl.textContent = `Not quite. μ error ~${muError.toFixed(1)}°, κ error total ${kError.toFixed(2)}. Try adjusting your estimates.`;
      bimodalFeedbackEl.className = 'feedback error';
    }
  });

  generateBimodalSample();

  /* ---- Hypothesis Testing ---- */
  const hypCanvasA = document.getElementById('hypothesisCanvasA');
  const hypCanvasB = document.getElementById('hypothesisCanvasB');
  const hypPlotA = new PolarPlot(hypCanvasA, false);
  const hypPlotB = new PolarPlot(hypCanvasB, false);
  let hypTrueDecision = 'fail';
  function generateHypothesisData() {
    const muA = Math.random() * TAU;
    const k = 4;
    const sampleA = generateVonMisesSamplesArray(200, muA, k);
    // Decide if B has same mean or different
    let muB, decision;
    if (Math.random() < 0.5) {
      muB = muA;
      decision = 'fail';
    } else {
      muB = wrapAngleToZeroToTwoPi(muA + (Math.random() * Math.PI + Math.PI / 4));
      decision = 'reject';
    }
    const sampleB = generateVonMisesSamplesArray(200, muB, k);
    hypPlotA.update(muA, k, sampleA);
    hypPlotB.update(muB, k, sampleB);
    // Generate a pseudo p-value: small if decision is reject
    const pval = decision === 'reject' ? (Math.random() * 0.05).toFixed(3) : (0.3 + Math.random() * 0.5).toFixed(3);
    document.getElementById('wwPValue').textContent = pval;
    hypTrueDecision = decision;
    // Reset radio buttons and feedback
    document.querySelectorAll('input[name="hypothesisDecision"]').forEach((r) => (r.checked = false));
    document.getElementById('hypothesisFeedback').textContent = '';
  }
  document.getElementById('generateHypothesis').addEventListener('click', generateHypothesisData);
  document.getElementById('checkHypothesis').addEventListener('click', () => {
    let sel = null;
    document.querySelectorAll('input[name="hypothesisDecision"]').forEach((r) => {
      if (r.checked) sel = r.value;
    });
    if (!sel) return;
    const fb = document.getElementById('hypothesisFeedback');
    if (sel === hypTrueDecision) {
      fb.textContent = 'Correct!';
      fb.className = 'feedback success';
      markComplete('hypothesis');
    } else {
      fb.textContent = `Incorrect. You should ${hypTrueDecision === 'reject' ? 'reject' : 'fail to reject'}.`;
      fb.className = 'feedback error';
    }
  });
  generateHypothesisData();

  /* ---- Real‑World Scenarios ---- */
  const scenarioPlot1 = new PolarPlot(document.getElementById('scenarioPlot1'), false);
  const scenarioPlot2 = new PolarPlot(document.getElementById('scenarioPlot2'), false);
  const scenarioPlot3 = new PolarPlot(document.getElementById('scenarioPlot3'), false);
  let scenarioCorrect = '1';
  const scenarios = [
    {
      text: 'Migratory birds head south in autumn with a preferred direction and strong agreement.',
      type: 'vonmises', k: 8
    },
    {
      text: 'People arrive at a hospital for a routine check-up uniformly throughout the day.',
      type: 'uniform'
    },
    {
      text: 'Wind direction is influenced by two competing weather systems, leading to two peaks.',
      type: 'bimodal'
    },
  ];
  function generateScenario() {
    // Pick random scenario
    const sc = scenarios[Math.floor(Math.random() * scenarios.length)];
    document.getElementById('scenarioText').textContent = sc.text;
    // Generate three plots: one for each distribution type; shuffle order
    const types = ['vonmises', 'bimodal', 'uniform'];
    const plots = [scenarioPlot1, scenarioPlot2, scenarioPlot3];
    // Shuffle types array to assign to plots
    const shuffled = types.sort(() => Math.random() - 0.5);
    shuffled.forEach((type, idx) => {
      let samps;
      let mu = Math.random() * TAU;
      if (type === 'vonmises') {
        const k = sc.k || (2 + Math.random() * 4);
        samps = generateVonMisesSamplesArray(300, mu, k);
        plots[idx].update(mu, k, samps);
      } else if (type === 'bimodal') {
        const mu1 = mu;
        const mu2 = wrapAngleToZeroToTwoPi(mu + Math.PI);
        const k = 4;
        const n = 300;
        samps = generateVonMisesSamplesArray(n / 2, mu1, k).concat(generateVonMisesSamplesArray(n / 2, mu2, k));
        plots[idx].update(mu, k, samps);
      } else {
        samps = [];
        for (let i = 0; i < 300; i++) samps.push(Math.random() * TAU);
        plots[idx].update(0, 0, samps);
      }
    });
    // Determine correct choice: index where type matches scenario type
    scenarioCorrect = (shuffled.indexOf(sc.type) + 1).toString();
    document.querySelectorAll('input[name="scenarioChoice"]').forEach((r) => (r.checked = false));
    document.getElementById('scenarioFeedback').textContent = '';
  }
  document.getElementById('generateScenario').addEventListener('click', generateScenario);
  document.getElementById('checkScenario').addEventListener('click', () => {
    let sel = null;
    document.querySelectorAll('input[name="scenarioChoice"]').forEach((r) => {
      if (r.checked) sel = r.value;
    });
    if (!sel) return;
    const fb = document.getElementById('scenarioFeedback');
    if (sel === scenarioCorrect) {
      fb.textContent = 'Correct!';
      fb.className = 'feedback success';
      markComplete('scenario');
    } else {
      fb.textContent = 'Incorrect. Try again or generate a new scenario.';
      fb.className = 'feedback error';
    }
  });
  generateScenario();

  /* ---- Parameter Estimation Challenge ---- */
  // Parameter estimation challenge (temporarily disabled)

  /* ---- Effect of Sample Size ---- */
  const effectCanvasA = document.getElementById('effectNSampleA');
  const effectCanvasB = document.getElementById('effectNSampleB');
  const effectPlotA = new PolarPlot(effectCanvasA, false);
  const effectPlotB = new PolarPlot(effectCanvasB, false);
  effectPlotA.setReferenceAngles([0]);
  effectPlotB.setReferenceAngles([0]);
  const effectMetaA = document.getElementById('effectNMetaA');
  const effectMetaB = document.getElementById('effectNMetaB');
  let effectTrueChoice = 'A';
  const effectState = {
    A: { se: null, samples: [] },
    B: { se: null, samples: [] },
  };

  function estimateMeanSE(samples) {
    const stats = computeCircularStatistics(samples);
    const n = samples.length;
    const R = Math.max(stats.R, 1e-6);
    return Math.sqrt(Math.max(1e-8, (2 * (1 - R)) / (n * R * R)));
  }

  function generateEffectNSamples() {
    const attemptLimit = 40;
    let best = null;
    let chosen = null;

    for (let attempt = 0; attempt < attemptLimit; attempt++) {
      const nA = 30 + Math.floor(Math.random() * 371);
      const nB = 30 + Math.floor(Math.random() * 371);
      const kA = 0.5 + Math.random() * 11.5;
      const kB = 0.5 + Math.random() * 11.5;
      const muA = Math.random() * TAU;
      const muB = Math.random() * TAU;
      const samplesA = generateVonMisesSamplesArray(nA, muA, kA);
      const samplesB = generateVonMisesSamplesArray(nB, muB, kB);
      const seA = estimateMeanSE(samplesA);
      const seB = estimateMeanSE(samplesB);
      const ratio = seA / (seB || 1e-6);
      const dist = Math.abs(Math.log(ratio));

      if (!best || dist < best.dist) {
        best = {
          nA,
          nB,
          kA,
          kB,
          muA,
          muB,
          samplesA,
          samplesB,
          seA,
          seB,
          dist,
        };
      }

      if (ratio > 0.8 && ratio < 1.25) {
        chosen = best;
        break;
      }
    }

    if (!chosen && best) {
      chosen = best;
    }

    if (!chosen) return;

    const panels = [
      {
        label: 'A',
        plot: effectPlotA,
        metaEl: effectMetaA,
        samples: chosen.samplesA,
        mu: chosen.muA,
        kappa: chosen.kA,
        n: chosen.nA,
        se: chosen.seA,
      },
      {
        label: 'B',
        plot: effectPlotB,
        metaEl: effectMetaB,
        samples: chosen.samplesB,
        mu: chosen.muB,
        kappa: chosen.kB,
        n: chosen.nB,
        se: chosen.seB,
      },
    ];

    if (Math.random() < 0.5) {
      panels.reverse();
    }

    panels.forEach((panel) => {
      panel.plot.update(panel.mu, panel.kappa, panel.samples);
      if (panel.metaEl) panel.metaEl.textContent = `N = ${panel.n}, κ ≈ ${panel.kappa.toFixed(1)}`;
      effectState[panel.label].se = panel.se;
      effectState[panel.label].samples = panel.samples;
    });

    effectTrueChoice = panels[0].se <= panels[1].se ? panels[0].label : panels[1].label;

    document.querySelectorAll('input[name="effectNChoice"]').forEach((r) => (r.checked = false));
    const fb = document.getElementById('effectNFeedback');
    fb.textContent = '';
    fb.className = 'feedback';
  }

  document.getElementById('generateEffectN').addEventListener('click', generateEffectNSamples);
  document.getElementById('checkEffectN').addEventListener('click', () => {
    let sel = null;
    document.querySelectorAll('input[name="effectNChoice"]').forEach((r) => {
      if (r.checked) sel = r.value;
    });
    if (!sel) return;
    const fb = document.getElementById('effectNFeedback');
    const seA = effectState.A.se !== null ? effectState.A.se.toFixed(3) : '—';
    const seB = effectState.B.se !== null ? effectState.B.se.toFixed(3) : '—';
    if (sel === effectTrueChoice) {
      fb.innerHTML = `<p><strong>Correct!</strong> ${effectTrueChoice === 'A' ? 'Sample A' : 'Sample B'} has the lower mean-direction standard error.</p><p>Sample A SE ≈ ${seA}, Sample B SE ≈ ${seB}</p>`;
      fb.className = 'feedback success';
      markComplete('effectn');
    } else {
      fb.innerHTML = `<p><strong>Not quite.</strong> ${effectTrueChoice === 'A' ? 'Sample A' : 'Sample B'} actually has the lower mean-direction standard error.</p><p>Sample A SE ≈ ${seA}, Sample B SE ≈ ${seB}</p>`;
      fb.className = 'feedback error';
    }
  });
  generateEffectNSamples();

  // Interactive Proof (multi‑step)

  // This section guides the learner through the derivation of R(κ) = I_1(κ)/I_0(κ).
  const proofStepsContainer = document.getElementById('proofSteps');
  const proofHint = document.getElementById('proofHint');
  const proofHistory = document.getElementById('proofHistory');
  const fullProofDiv = document.getElementById('fullProof');
  const nextProofBtn = document.getElementById('nextProofStep');
  const hintBtn = document.getElementById('hintBtn');
  const showFullBtn = document.getElementById('showFullProof');
  // Define a sequence of proof steps. Each step has a question, multiple options,
  // a hint and an explanation. 
  // When the learner selects the correct option and clicks Next, the next step is displayed. 
  // Hints are revealed on demand
  const proofStepsData = [
    {
      question: 'Express the mean resultant length R in terms of the expectation of a trigonometric function of Θ − μ.',
      options: [
        // Wrap each option label in inline math delimiters so KaTeX renders them 
        // Double escaping ensures the delimiters survive JavaScript string parsing
        { val: 'a', label: '\\(R = \\mathbb{E}[\\cos(\\Theta - \\mu)]\\)', correct: true },
        { val: 'b', label: '\\(R = \\mathbb{E}[\\sin(\\Theta - \\mu)]\\)', correct: false },
        { val: 'c', label: '\\(R = \\mathbb{E}[\\cos\\Theta]\\)', correct: false },
      ],
      hint: `
        <p><strong>Magnitude</strong> is another word for “length”. For a point (3, 4) in the plane, its distance from the origin is <span class="math-inline">√(3² + 4²) = 5</span>.</p>
        <p><strong>Vector sum</strong> means adding arrows tip-to-tail. Imagine a wind of 2 m/s east added to a walk of 3 m/s north—you get a diagonal arrow whose length comes from Pythagoras.</p>
        <div class="hint-figure">
          <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true">
            <defs>
              <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <polygon points="0 0, 6 3, 0 6" fill="#334155" />
              </marker>
            </defs>
            <line x1="10" y1="70" x2="70" y2="70" stroke="#334155" stroke-width="2" marker-end="url(#arrowhead)" />
            <line x1="70" y1="70" x2="70" y2="20" stroke="#0ea5e9" stroke-width="2" marker-end="url(#arrowhead)" />
            <line x1="10" y1="70" x2="70" y2="20" stroke="#ef4444" stroke-width="2" marker-end="url(#arrowhead)" />
            <text x="40" y="76" font-size="9">vector 1</text>
            <text x="76" y="45" font-size="9" transform="rotate(-90 76 45)">vector 2</text>
            <text x="40" y="35" font-size="9">sum</text>
          </svg>
        </div>
        <p><strong>Mean resultant length</strong> is the length of the arrow you get after averaging all the unit phasors. It measures how tightly the directions cluster.</p>
        <p>In our formula the symbols mean:</p>
        <ul>
          <li>θ is a random angle drawn from the von Mises distribution.</li>
          <li>μ is the mean direction of that distribution.</li>
          <li>cos 0 = 1 and cos 1 (≈ 0.54) describe the horizontal component of unit phasors.</li>
          <li>sin 0 = 0 and sin 1 (≈ 0.84) give the vertical component.</li>
        </ul>
        <p>So our goal is to express the average arrow in terms of cos (θ − μ) and sin (θ − μ), then keep just the cosine part because it controls the length.</p>
      `,
      explanation: `
        <p>A <em>unit phasor</em> is e<sup>i(θ−μ)</sup> = cos(θ−μ) + i sin(θ−μ). Its length is one.</p>
        <p>Averaging many such phasors cancels the sine part by symmetry. The cosine part sets the length of the average, so R = E[cos(θ−μ)].</p>
      `,
    },
    {
      question: 'Rewrite this expectation as a 0–2pi integral involving the von Mises density f(θ | μ, κ).',
      options: [
        { val: 'a', label: '\\(R = \\frac{1}{2\\pi I_0(\\kappa)} \\int_0^{2\\pi} \\cos(\\theta - \\mu)\\, e^{\\kappa \\cos(\\theta - \\mu)}\\,\\mathrm{d}\\theta\\)', correct: true },
        { val: 'b', label: '\\(R = \\int_0^{2\\pi} \\sin(\\theta - \\mu)\\, e^{\\kappa \\cos(\\theta - \\mu)}\\,\\mathrm{d}\\theta\\)', correct: false },
        { val: 'c', label: '\\(R = \\int_0^{2\\pi} e^{\\kappa \\cos(\\theta - \\mu)}\\,\\mathrm{d}\\theta\\)', correct: false },
      ],
      hint: `
        <p><strong>Expectation as an integral.</strong> For any function g, <span class="math-inline">E[g(Θ)] = ∫_0²π g(θ) f(θ) dθ</span>. Think of it as averaging grades by weighting each score by how likely it is.</p>
        <p><strong>Our function.</strong> g(θ) = cos (θ − μ); it extracts the horizontal component of each unit phasor.</p>
        <p><strong>Von Mises PDF.</strong> <span class="math-inline">f(θ | μ, κ) = e^{κ cos(θ−μ)} / (2π I_0(κ))</span>. The exponential weights angles near μ more strongly when κ is large.</p>
        <p><strong>Normalisation.</strong> The denominator 2π I_0(κ) keeps the total probability around the circle equal to 1, just as 1/√(2πσ²) normalises a normal curve.</p>
        <p>Multiply cos (θ − μ) by this PDF and integrate from 0 to 2π—that gives the expectation we need.</p>
      `,
      explanation: `
        <p>The von Mises density is f(θ | μ, κ) = e^{κ cos(θ−μ)} / (2π I_0(κ)).</p>
        <p>Multiplying cos(θ−μ) by that density and integrating around the circle produces the expectation we want. The denominator 2π I_0(κ) keeps the PDF normalised.</p>
      `,
    },
    {
      // Wrap the integral in inline delimiters for KaTeX rendering
      question: 'Evaluate the numerator integral \\(\\int_0^{2\\pi} \\cos(\\theta - \\mu) e^{\\kappa \\cos(\\theta - \\mu)}\\,\\mathrm{d}\\theta\\).',
      options: [
        { val: 'a', label: '\\(2\\pi I_1(\\kappa)\\)', correct: true },
        { val: 'b', label: '\\(2\\pi I_0(\\kappa)\\)', correct: false },
        { val: 'c', label: '\\(0\\)', correct: false },
      ],
      hint: `
        <p><strong>Modified Bessel reminder.</strong> <span class="math-inline">I_1(κ) = (1/π) ∫_0^π cos φ·e^{κ cos φ} dφ</span>.</p>
        <p><strong>Match our integrand.</strong> Substitute φ = θ − μ. The cosine and exponential then match the integrand above.</p>
        <p><strong>Handle the limits.</strong> Our integral runs 0→2π. Split it into two halves (0→π and π→2π); each half equals π I_1(κ) because cosine is even.</p>
        <p>Adding the halves gives 2π I_1(κ) for the numerator.</p>
      `,
      explanation: `
        <p>The modified Bessel function has the integral form I_1(κ) = (1/π)∫_0^π cos φ·e^{κ cos φ} dφ.</p>
        <p>Our integral runs from 0 to 2π. After substituting φ = θ−μ, it matches the definition and evaluates to 2π I_1(κ).</p>
      `,
    },
    {
      question: 'Combine the numerator and denominator to obtain R(κ). Which expression is correct?',
      options: [
        { val: 'a', label: '\\(R(\\kappa) = \\frac{I_1(\\kappa)}{I_0(\\kappa)}\\)', correct: true },
        { val: 'b', label: '\\(R(\\kappa) = \\frac{I_0(\\kappa)}{I_1(\\kappa)}\\)', correct: false },
        { val: 'c', label: '\\(R(\\kappa) = I_1(\\kappa) + I_0(\\kappa)\\)', correct: false },
      ],
      hint: `
        <p><strong>Numerator recap.</strong> We found the integral equals 2π I_1(κ).</p>
        <p><strong>Denominator recap.</strong> The PDF contributes 2π I_0(κ) through its normalising constant.</p>
        <p><strong>Take the ratio.</strong> R(κ) = I_1(κ) / I_0(κ). Values near 1 signal tightly clustered angles; values near 0 indicate a broad spread.</p>
      `,
      explanation: `
        <p>The numerator equals 2π I_1(κ). The denominator from the PDF normalisation is 2π I_0(κ).</p>
        <p>Dividing cancels 2π and leaves R(κ) = I_1(κ)/I_0(κ). The ratio approaches 1 when samples cluster tightly and drops toward 0 when they are spread out.</p>
      `,
    },
  ];
  let currentProofStep = 0;
  /* Render the current proof step. */
  function renderProofStep() {
    proofHint.textContent = '';
    proofStepsContainer.innerHTML = '';
    if (proofHistory && currentProofStep === 0) {
      proofHistory.innerHTML = '';
    }
    if (currentProofStep >= proofStepsData.length) {
      // Completed all steps
      proofStepsContainer.innerHTML = '<p><strong>Proof complete!</strong> You have derived \(R(\kappa) = I_1(\kappa)/I_0(\kappa)\).</p>';
      markComplete('proof');
      return;
    }
    const step = proofStepsData[currentProofStep];
    const qElem = document.createElement('p');
    qElem.innerHTML = step.question;
    proofStepsContainer.appendChild(qElem);
    // Create radio buttons
    step.options.forEach((opt) => {
      const label = document.createElement('label');
      label.style.display = 'block';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'proofStepOption';
      input.value = opt.val;
      label.appendChild(input);
      const span = document.createElement('span');
      span.innerHTML = ' ' + opt.label;
      label.appendChild(span);
      proofStepsContainer.appendChild(label);
    });
    // Re-render math inside the proof step after insertion using a safe wrapper
    // If KaTeX is unavailable this does nothing.
    safeRenderMathInElement(proofStepsContainer);
  }
  // Initialize first step
  renderProofStep();

  function appendProofExplanation(stepIndex) {
    if (!proofHistory) return;
    const step = proofStepsData[stepIndex];
    const block = document.createElement('div');
    block.className = 'proof-explanation';
    block.innerHTML = `<h5>Step ${stepIndex + 1}</h5>${step.explanation}`;
    proofHistory.appendChild(block);
    safeRenderMathInElement(block);
  }

  let hintVisible = false;
  nextProofBtn.addEventListener('click', () => {
    // Find selected option
    let sel = null;
    proofStepsContainer.querySelectorAll('input[name="proofStepOption"]').forEach((r) => {
      if (r.checked) sel = r.value;
    });
    if (!sel) return;
    const step = proofStepsData[currentProofStep];
    const selectedOpt = step.options.find((o) => o.val === sel);
    if (selectedOpt && selectedOpt.correct) {
      appendProofExplanation(currentProofStep);
      currentProofStep++;
      renderProofStep();
      hintVisible = false;
      proofHint.textContent = '';
      proofHint.className = 'feedback';
    } else {
      proofHint.textContent = 'Incorrect. Try again or ask for a hint.';
      proofHint.className = 'feedback error';
    }
  });
  hintBtn.addEventListener('click', () => {
    if (currentProofStep < proofStepsData.length) {
      if (hintVisible) {
        proofHint.textContent = '';
        proofHint.className = 'feedback';
        hintVisible = false;
      } else {
        proofHint.innerHTML = proofStepsData[currentProofStep].hint;
        proofHint.className = 'feedback';
        safeRenderMathInElement(proofHint);
        hintVisible = true;
      }
    }
  });
  showFullBtn.addEventListener('click', () => {
    if (!fullProofDiv.hidden) {
      fullProofDiv.hidden = true;
      return;
    }
    // Build full derivation text with LaTeX
    const parts = [];
    parts.push('<p><strong>1.</strong> A unit phasor can be written as e<sup>i(θ−μ)</sup> = cos(θ−μ) + i sin(θ−μ). Averaging many of them leaves only the cosine part, so R = E[cos(θ−μ)].</p>');
    parts.push('<p><strong>2.</strong> Replace the expectation by an integral using the von Mises density f(θ | μ, κ) = e^{κ cos(θ−μ)}/(2π I_0(κ)):</p>');
    parts.push('<p class="math-inline">R = (1/(2π I_0(κ))) ∫_0^{2π} cos(θ−μ) · e^{κ cos(θ−μ)} dθ.</p>');
    parts.push('<p><strong>3.</strong> That integral matches the definition of the modified Bessel function of order 1, giving 2π I_1(κ).</p>');
    parts.push('<p><strong>4.</strong> Dividing numerator 2π I_1(κ) by denominator 2π I_0(κ) yields R(κ) = I_1(κ)/I_0(κ).</p>');
    fullProofDiv.innerHTML = parts.join('');
    fullProofDiv.hidden = false;
  });

  // Concentration Ranking
  const rankCanvases = [
    document.getElementById('rankPlot1'),
    document.getElementById('rankPlot2'),
    document.getElementById('rankPlot3'),
    document.getElementById('rankPlot4'),
  ];
  const rankPlots = rankCanvases.map((cv) => new PolarPlot(cv, false));
  let rankKappas = [];
  let rankOrder = [];
  const rankingFilters = ['none', 'brightness(0.82)', 'brightness(0.68)', 'brightness(0.56)', 'brightness(0.44)'];
  function generateRankingPlots() {
    // Choose four distinct κ values
    rankKappas = [0.5 + Math.random() * 1.5, 2 + Math.random() * 2, 5 + Math.random() * 5, 10 + Math.random() * 10];
    // Shuffle ordering of kappa assignments to canvases
    const shuffledIndices = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    shuffledIndices.forEach((shIdx, canvasIdx) => {
      const k = rankKappas[shIdx];
      const mu = 0;
      const samps = generateVonMisesSamplesArray(200, mu, k);
      rankPlots[canvasIdx].update(mu, k, samps);
      rankCanvases[canvasIdx].dataset.kappa = k;
    });
    rankOrder = [];
    // Clear feedback
    document.getElementById('rankingFeedback').textContent = '';
    refreshRankingSelections();
  }
  document.getElementById('generateRanking').addEventListener('click', generateRankingPlots);
  // Handle clicks for selecting order
  function refreshRankingSelections() {
    rankCanvases.forEach((canvas) => {
      canvas.classList.remove('selected');
      canvas.style.filter = 'none';
      canvas.style.boxShadow = 'none';
      delete canvas.dataset.order;
    });
    rankOrder.forEach((selIdx, orderIdx) => {
      const canvas = rankCanvases[selIdx];
      canvas.classList.add('selected');
      const filterIdx = Math.min(orderIdx + 1, rankingFilters.length - 1);
      canvas.style.filter = rankingFilters[filterIdx];
      canvas.style.boxShadow = '0 0 0 2px var(--accent)';
      canvas.dataset.order = orderIdx + 1;
    });
  }

  rankCanvases.forEach((cv, idx) => {
    cv.addEventListener('click', () => {
      const existing = rankOrder.indexOf(idx);
      if (existing !== -1) {
        rankOrder.splice(existing, 1);
        refreshRankingSelections();
        playTone(70, 0.005, 0.2, 0.55);
        return;
      }
      if (rankOrder.length >= 4) return;
      rankOrder.push(idx);
      refreshRankingSelections();
      const baseFreq = 140;
      playTone(baseFreq - rankOrder.length * 10, 0.005, 0.24, 0.65);
    });
  });
  document.getElementById('checkRanking').addEventListener('click', () => {
    const fb = document.getElementById('rankingFeedback');
    if (rankOrder.length < 4) {
      fb.textContent = 'Please select all four plots in order.';
      fb.className = 'feedback error';
      return;
    }
    // Determine actual ascending order of kappas in displayed order
    const actual = rankCanvases.map((cv, idx) => ({ idx, k: parseFloat(cv.dataset.kappa) }));
    actual.sort((a, b) => a.k - b.k);
    const correctOrder = actual.map((obj) => obj.idx);
    let correct = true;
    for (let i = 0; i < 4; i++) {
      if (rankOrder[i] !== correctOrder[i]) {
        correct = false;
        break;
      }
    }
    if (correct) {
      fb.textContent = 'Correct! You ranked the concentrations accurately.';
      fb.className = 'feedback success';
      markComplete('ranking');
    } else {
      fb.textContent = 'Incorrect. Try again or generate new plots.';
      fb.className = 'feedback error';
    }
  });
  generateRankingPlots();

  // Automatically render all LaTeX math once the DOM is ready. 
  // Use the safe wrapper to avoid errors if KaTeX has not loaded.  
  // When you do that: The delimiters configured in safeRenderMathInElement will apply.
  safeRenderMathInElement(document.body);
});
