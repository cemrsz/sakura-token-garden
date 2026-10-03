// Prosedürel 2D bahçe. Her AI kendi ağaç türünü büyütür (themes.js); tek girdi ilerleme p ∈ [0, 1].
// p arttıkça: toprak çatlar → filiz → gövde ve dallar → yapraklar → tomurcuk / renk dönümü → çiçek / kızıl yaprak → final.

import { themeOf } from './themes.js';

const TAU = Math.PI * 2;
const UP = -Math.PI / 2;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2));

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(color) {
  const value = parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
function mix(a, b, t) {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  return `rgb(${Math.round(lerp(r1, r2, t))},${Math.round(lerp(g1, g2, t))},${Math.round(lerp(b1, b2, t))})`;
}

// Büyüme evrelerinin ilerleme aralıkları.
const PHASE = {
  crack: [0, 0.025],
  sprout: [0.015, 0.1],
  sproutFade: [0.095, 0.135],
  wood: [0.07, 0.58],
  girth: [0.07, 0.85],
  leaves: [0.32, 0.6],
  leafFade: [0.82, 1],
  budLead: 0.1,
  bloom: [0.68, 0.985],
  canopy: [0.78, 0.99],
};

const MOUND = { width: 272, height: 38 };

// ---------------------------------------------------------------------------
// Ağaç yapısı

function buildTree(seed, spread = 1) {
  const rnd = mulberry32(seed);
  const limbs = [];
  const flowers = [];
  const leaves = [];
  const blobs = [];
  const SPEED = 0.002;

  function angleAt(limb, at) {
    return limb.pa[Math.min(limb.n - 1, Math.floor(at * limb.n))];
  }

  function addLimb({ parent = null, at = 1, abs, length, w0, w1, depth, curve = 0, wobble = 0.1, upPull = 0.012, stiff = false, segs }) {
    const n = segs || Math.max(4, Math.round(length / 15));
    const limb = {
      parent, at, n, length, seg: length / n, w0, w1, depth, stiff,
      bends: [], px: new Float32Array(n + 1), py: new Float32Array(n + 1), pa: new Float32Array(n),
      phase: rnd() * TAU,
      swayAmp: stiff ? 0 : depth === 0 ? 0.004 : 0.008 + depth * 0.009,
      swayFreq: 0.9 + rnd() * 0.5,
      t0: 0, t1: 0, marks: [], terminal: false, children: [],
    };
    if (parent) parent.children.push(limb);
    const base = parent ? angleAt(parent, at) : 0;
    limb.rel = abs - base;
    let a = abs;
    for (let i = 0; i < n; i += 1) {
      const bend = curve / n + (rnd() - 0.5) * wobble + (UP - a) * upPull;
      limb.bends.push(bend);
      a += bend;
    }
    limb.t0 = parent ? parent.t0 + at * (parent.t1 - parent.t0) : 0;
    limb.t1 = limb.t0 + length * SPEED;
    poseLimb(limb, 0, 0);
    if (w0 > 12) {
      for (let i = 0; i < 3; i += 1) {
        const s0 = 0.08 + rnd() * 0.45;
        limb.marks.push({ s0, s1: Math.min(0.95, s0 + 0.25 + rnd() * 0.3), offset: (rnd() - 0.5) * 0.55, twist: 0.6 + rnd() * 1.4 });
      }
    }
    limbs.push(limb);
    return limb;
  }

  function addFlowers(limb, count, from, spreadSize) {
    for (let i = 0; i < count; i += 1) {
      flowers.push({
        limb, u: from + rnd() * (1 - from),
        dx: (rnd() - 0.5) * spreadSize * 1.5, dy: (rnd() - 0.3) * spreadSize,
        size: 24 + rnd() * 12, rot: rnd() * TAU, tint: Math.floor(rnd() * 3),
        birth: lerp(PHASE.bloom[0], PHASE.bloom[1], rnd()), phase: rnd() * TAU,
      });
    }
  }

  function addLeaves(limb, count, from) {
    for (let i = 0; i < count; i += 1) {
      const side = i % 2 ? 1 : -1;
      leaves.push({
        limb, u: from + rnd() * (1 - from), side,
        angle: side * (0.5 + rnd() * 0.8), size: 17 + rnd() * 8, tint: rnd() > 0.6 ? 1 : 0,
        birth: lerp(PHASE.leaves[0], PHASE.leaves[1], rnd()), phase: rnd() * TAU,
      });
    }
  }

  function addBlob(limb, u, r) {
    blobs.push({ limb, u, dx: (rnd() - 0.5) * 16, dy: (rnd() - 0.5) * 12, r, birth: lerp(PHASE.canopy[0], PHASE.canopy[1] - 0.05, rnd()) });
  }

  function branch(limb, maxDepth) {
    const end = limb.pa[limb.n - 1];
    const depth = limb.depth + 1;
    if (limb.depth >= maxDepth || limb.length < 26) {
      limb.terminal = true;
      addFlowers(limb, 6 + Math.floor(rnd() * 4), 0.3, 42);
      addLeaves(limb, 4 + Math.floor(rnd() * 3), 0.25);
      addBlob(limb, 0.85, 40 + rnd() * 14);
      addBlob(limb, 0.4, 30 + rnd() * 10);
      return;
    }
    if (limb.depth === 1) addLeaves(limb, 3 + Math.floor(rnd() * 2), 0.35);
    if (limb.depth >= 2) {
      addFlowers(limb, 2 + Math.floor(rnd() * 3), 0.3, 26);
      addLeaves(limb, 2 + Math.floor(rnd() * 2), 0.3);
      addBlob(limb, 0.7, 30 + rnd() * 10);
    }
    const sign = rnd() > 0.5 ? 1 : -1;
    const keep = addLimb({
      parent: limb, at: 1, abs: end + (rnd() - 0.5) * 0.45, length: limb.length * (0.72 + rnd() * 0.08),
      w0: limb.w1, w1: limb.w1 * 0.6, depth, curve: (rnd() - 0.5) * 0.8,
    });
    branch(keep, maxDepth);
    const fork = addLimb({
      parent: limb, at: 0.92, abs: end + sign * (0.55 + rnd() * 0.3) * spread, length: limb.length * (0.64 + rnd() * 0.1),
      w0: limb.w1 * 0.85, w1: limb.w1 * 0.52, depth, curve: sign * (0.25 + rnd() * 0.35),
    });
    branch(fork, maxDepth);
    if (limb.depth >= 1 && rnd() < 0.5) {
      const at = 0.45 + rnd() * 0.2;
      const width = lerp(limb.w0, limb.w1, at);
      const side = addLimb({
        parent: limb, at, abs: angleAt(limb, at) - sign * (0.7 + rnd() * 0.3), length: limb.length * (0.45 + rnd() * 0.1),
        w0: width * 0.62, w1: width * 0.36, depth: maxDepth, curve: -sign * 0.4,
      });
      branch(side, maxDepth);
    }
  }

  const trunk = addLimb({ abs: UP, length: 156 / Math.sqrt(spread), w0: 50, w1: 31, depth: 0, curve: 0, wobble: 0.04, upPull: 0, segs: 12 });
  // S kıvrımı: gövdeye çizgi film tarzı bir burgu verir.
  trunk.bends = trunk.bends.map((_, i) => (i < 4 ? 0.065 : i < 9 ? -0.085 : 0.06) + (rnd() - 0.5) * 0.02);
  poseLimb(trunk, 0, 0);
  // Kökler (sabit, rüzgârdan etkilenmez)
  for (const [abs, length] of [[Math.PI - 0.08, 38], [0.06, 42], [Math.PI * 0.6, 26]]) {
    addLimb({ parent: trunk, at: 0.02, abs, length, w0: 24, w1: 8, depth: 1, curve: abs > 1.6 ? -0.3 : 0.3, wobble: 0.05, upPull: 0, stiff: true, segs: 5 });
  }
  // Alt yan dal
  const lowSide = rnd() > 0.5 ? 1 : -1;
  const low = addLimb({ parent: trunk, at: 0.6, abs: UP + lowSide * 1.0 * spread, length: 84, w0: 19, w1: 11, depth: 2, curve: -lowSide * 0.45 });
  branch(low, 3);
  // Ana taç dalları
  const mains = [
    { abs: UP - 0.92 * spread, length: 112, w0: 29, w1: 16, curve: 0.3 },
    { abs: UP + 0.02, length: 90, w0: 25, w1: 14, curve: -0.1 },
    { abs: UP + 0.92 * spread, length: 114, w0: 29, w1: 16, curve: -0.3 },
  ];
  for (const main of mains) branch(addLimb({ parent: trunk, at: 1, depth: 1, ...main }), 3);

  // Zamanları normalize et: en geç biten dal p = PHASE.wood[1] anında biter.
  const maxT = Math.max(...limbs.map((limb) => limb.t1));
  for (const limb of limbs) {
    limb.p0 = lerp(PHASE.wood[0], PHASE.wood[1], limb.t0 / maxT);
    limb.p1 = lerp(PHASE.wood[0], PHASE.wood[1], limb.t1 / maxT);
    if (limb.stiff) {
      // Kökler gövde kalınlaştıkça toprağa yayılır.
      limb.p0 = 0.2;
      limb.p1 = 0.48;
    }
  }
  // Çiçekler, taşıyıcı dal çıktıktan sonra açar.
  for (const flower of flowers) flower.birth = Math.max(flower.birth, flower.limb.p1 + PHASE.budLead + 0.02);
  for (const leaf of leaves) leaf.birth = Math.max(leaf.birth, lerp(leaf.limb.p0, leaf.limb.p1, leaf.u) + 0.015);
  flowers.sort((a, b) => a.birth - b.birth);

  // Tam büyümüş ağacın sınırları: kamera bunu ekrana sığdırır, taç asla kırpılmaz.
  const bounds = { minX: -MOUND.width * 0.6, maxX: MOUND.width * 0.6, minY: -60 };
  const include = (x, y, r) => {
    bounds.minX = Math.min(bounds.minX, x - r);
    bounds.maxX = Math.max(bounds.maxX, x + r);
    bounds.minY = Math.min(bounds.minY, y - r);
  };
  for (const limb of limbs) {
    for (let i = 0; i <= limb.n; i += 1) include(limb.px[i], limb.py[i], lerp(limb.w0, limb.w1, i / limb.n) / 2);
  }
  for (const flower of flowers) {
    const at = attached(flower);
    include(at.x, at.y, flower.size * 0.55);
  }
  for (const blob of blobs) {
    const at = attached(blob);
    include(at.x, at.y, blob.r);
  }
  return { limbs, flowers, leaves, blobs, bounds };
}

// Dengeli bir taç veren ilk tohumu seçer (simetrik, enine geniş).
function pickTree(seed, spread) {
  let best = null;
  for (let i = 0; i < 40; i += 1) {
    const tree = buildTree(seed + i, spread);
    const { minX, maxX, minY } = tree.bounds;
    const score = Math.abs(minX + maxX) * 2 + Math.abs((maxX - minX) / -minY - 1.25 * spread) * 200;
    if (!best || score < best.score) best = { tree, score };
    if (score < 30) break;
  }
  return best.tree;
}

function poseLimb(limb, time, wind) {
  let x = 0;
  let y = 0;
  let a = limb.rel;
  if (limb.parent) {
    const parent = limb.parent;
    const index = limb.at * parent.n;
    const i = Math.min(parent.n - 1, Math.floor(index));
    const f = index - i;
    x = lerp(parent.px[i], parent.px[i + 1], f);
    y = lerp(parent.py[i], parent.py[i + 1], f);
    a += parent.pa[i];
  }
  if (!limb.stiff && wind) a += limb.swayAmp * wind * Math.sin(time * limb.swayFreq + limb.phase);
  limb.px[0] = x;
  limb.py[0] = y;
  for (let i = 0; i < limb.n; i += 1) {
    a += limb.bends[i];
    limb.pa[i] = a;
    limb.px[i + 1] = limb.px[i] + Math.cos(a) * limb.seg;
    limb.py[i + 1] = limb.py[i] + Math.sin(a) * limb.seg;
  }
}

function limbPoint(limb, u) {
  const index = clamp(u) * limb.n;
  const i = Math.min(limb.n - 1, Math.floor(index));
  const f = index - i;
  return {
    x: lerp(limb.px[i], limb.px[i + 1], f),
    y: lerp(limb.py[i], limb.py[i + 1], f),
    a: limb.pa[i],
  };
}

// Dal üzerindeki bir noktaya, dalın yerel eksenine göre ofset uygular.
function attached(item) {
  const point = limbPoint(item.limb, item.u);
  const c = Math.cos(point.a);
  const s = Math.sin(point.a);
  return { x: point.x + c * item.dy - s * item.dx, y: point.y + s * item.dy + c * item.dx, a: point.a };
}

// ---------------------------------------------------------------------------
// Sprite'lar (tema renkleriyle bir kez çizilip drawImage ile kopyalanır)

function canvasOf(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function petalPath(ctx, r) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-r * 0.62, -r * 0.22, -r * 0.7, -r * 0.86, -r * 0.2, -r);
  ctx.lineTo(0, -r * 0.84);
  ctx.lineTo(r * 0.2, -r);
  ctx.bezierCurveTo(r * 0.7, -r * 0.86, r * 0.62, -r * 0.22, 0, 0);
  ctx.closePath();
}

// Beş loblu akçaağaç yaprağı; merkez (0,0), uçlar r yarıçapında.
const MAPLE_LOBES = [[-152, 0.84], [-90, 1], [-28, 0.84], [32, 0.56], [148, 0.56]];
function maplePath(ctx, r) {
  const polar = (deg, radius) => [Math.cos((deg * Math.PI) / 180) * radius * r, Math.sin((deg * Math.PI) / 180) * radius * r];
  const points = [];
  MAPLE_LOBES.forEach(([angle, length], index) => {
    const [nextAngle] = MAPLE_LOBES[(index + 1) % MAPLE_LOBES.length];
    const span = ((nextAngle - angle + 360) % 360);
    points.push(
      polar(angle - 20, length * 0.5), polar(angle - 11, length * 0.74), polar(angle - 6, length * 0.66),
      polar(angle, length),
      polar(angle + 6, length * 0.66), polar(angle + 11, length * 0.74), polar(angle + 20, length * 0.5),
      polar(angle + span / 2, span > 100 ? 0.2 : 0.32),
    );
  });
  ctx.beginPath();
  points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function drawMaple(ctx, r, light, mid, dark, line, lineWidth) {
  const gradient = ctx.createRadialGradient(0, -r * 0.1, 0, 0, 0, r);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.5, mid);
  gradient.addColorStop(1, dark);
  ctx.lineJoin = 'round';
  maplePath(ctx, r);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  // damarlar ve sap
  ctx.strokeStyle = line;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = lineWidth * 0.7;
  ctx.lineCap = 'round';
  for (const [angle, length] of MAPLE_LOBES) {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.08);
    ctx.lineTo(Math.cos((angle * Math.PI) / 180) * length * r * 0.8, Math.sin((angle * Math.PI) / 180) * length * r * 0.8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = lineWidth * 1.1;
  ctx.beginPath();
  ctx.moveTo(0, r * 0.1);
  ctx.quadraticCurveTo(r * 0.06, r * 0.5, -r * 0.04, r * 0.8);
  ctx.stroke();
}

function blossomSprite(size, theme, tint) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const { flower } = theme;
  const [inner, middle, outer, line] = flower.palettes[tint];
  const r = size * 0.47;
  ctx.translate(size / 2, size / 2);
  if (flower.shape === 'maple') {
    drawMaple(ctx, r * 0.98, inner, middle, outer, line, size * 0.028);
    return canvas;
  }
  ctx.lineJoin = 'round';
  for (let i = 0; i < 5; i += 1) {
    ctx.save();
    ctx.rotate((i / 5) * TAU);
    const gradient = ctx.createRadialGradient(0, -r * 0.1, 0, 0, -r * 0.5, r);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.45, middle);
    gradient.addColorStop(1, outer);
    petalPath(ctx, r);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = size * 0.028;
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = flower.stamen;
  ctx.lineWidth = size * 0.018;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU + 0.3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34);
    ctx.stroke();
    ctx.fillStyle = flower.anther;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, size * 0.025, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = flower.center;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.13, 0, TAU);
  ctx.fill();
  return canvas;
}

function budSprite(size, theme) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const { bud } = theme;
  ctx.translate(size / 2, size / 2);
  const r = size * 0.4;
  if (bud.shape === 'maple') {
    drawMaple(ctx, r * 1.1, bud.light, bud.mid, bud.dark, bud.line, size * 0.045);
    return canvas;
  }
  ctx.fillStyle = '#7fae4b';
  ctx.strokeStyle = '#3f6f2f';
  ctx.lineWidth = size * 0.04;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 0.42, r * 0.32, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  const gradient = ctx.createRadialGradient(-r * 0.25, -r * 0.35, 0, 0, 0, r);
  gradient.addColorStop(0, bud.light);
  gradient.addColorStop(0.55, bud.mid);
  gradient.addColorStop(1, bud.dark);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = bud.line;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.bezierCurveTo(r * 0.75, -r * 0.55, r * 0.7, r * 0.45, 0, r * 0.55);
  ctx.bezierCurveTo(-r * 0.7, r * 0.45, -r * 0.75, -r * 0.55, 0, -r);
  ctx.fill();
  ctx.stroke();
  return canvas;
}

function leafSprite(size, theme, tint) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const { leaf } = theme;
  const [light, dark] = leaf.palettes[tint];
  ctx.translate(size / 2, size / 2);
  const r = size * 0.46;
  if (leaf.shape === 'maple') {
    drawMaple(ctx, r, light, light, dark, leaf.line, size * 0.04);
    return canvas;
  }
  const gradient = ctx.createLinearGradient(-r * 0.4, -r, r * 0.4, r);
  gradient.addColorStop(0, light);
  gradient.addColorStop(1, dark);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = leaf.line;
  ctx.lineWidth = size * 0.045;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, r);
  ctx.bezierCurveTo(r * 0.72, r * 0.35, r * 0.62, -r * 0.55, 0, -r);
  ctx.bezierCurveTo(-r * 0.62, -r * 0.55, -r * 0.72, r * 0.35, 0, r);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(61,107,44,.55)';
  ctx.lineWidth = size * 0.03;
  ctx.beginPath();
  ctx.moveTo(0, r * 0.85);
  ctx.quadraticCurveTo(r * 0.06, 0, 0, -r * 0.7);
  ctx.stroke();
  return canvas;
}

function petalSprite(size, theme) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const { petal } = theme;
  if (petal.shape === 'maple') {
    ctx.translate(size / 2, size / 2);
    drawMaple(ctx, size * 0.46, petal.light, petal.light, petal.dark, petal.line, size * 0.05);
    return canvas;
  }
  ctx.translate(size / 2, size * 0.92);
  const gradient = ctx.createLinearGradient(0, 0, 0, -size * 0.85);
  gradient.addColorStop(0, petal.light);
  gradient.addColorStop(1, petal.dark);
  petalPath(ctx, size * 0.85);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = petal.line;
  ctx.lineWidth = size * 0.05;
  ctx.stroke();
  return canvas;
}

function glowSprite(size, theme) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,240,1)');
  gradient.addColorStop(0.25, theme.mote[0]);
  gradient.addColorStop(0.55, theme.mote[1]);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

// ---------------------------------------------------------------------------
// Bitki: tek bir AI'ın ağacı

class Plant {
  constructor(scene, id) {
    this.scene = scene;
    this.id = id;
    this.theme = themeOf(id);
    this.tree = pickTree(this.theme.seed, this.theme.spread);
    this.rnd = mulberry32(this.theme.seed ^ 0x9e3779b9);
    this.target = 0;
    this.shown = 0;
    this.introDone = false;
    this.petals = [];
    this.groundPetals = [];
    this.petalClock = 0;
    this.energy = 0;
    this.glow = 0;
    this.cx = null;
    this.view = null;
    const theme = this.theme;
    this.sprites = {
      blossoms: [0, 1, 2].map((tint) => blossomSprite(96, theme, tint)),
      bud: budSprite(48, theme),
      leaves: [leafSprite(64, theme, 0), leafSprite(64, theme, 1)],
      petal: petalSprite(40, theme),
      glow: glowSprite(48, theme),
    };
    this.tufts = this.makeTufts();
  }

  get ctx() { return this.scene.ctx; }
  get dpr() { return this.scene.dpr; }
  get time() { return this.scene.time; }
  get reduced() { return this.scene.reduced; }

  setProgress(value, instant) {
    this.target = clamp(value, 0, 1);
    if (instant) {
      this.shown = this.target;
      this.introDone = true;
    }
  }

  makeTufts() {
    const rnd = mulberry32(77 + this.theme.seed);
    const tufts = [];
    for (let i = 0; i < 16; i += 1) {
      const x = lerp(-MOUND.width * 0.5 + 8, MOUND.width * 0.5 - 8, i / 15) + (rnd() - 0.5) * 10;
      tufts.push({ x, front: rnd() > 0.45, blades: 2 + Math.floor(rnd() * 3), height: 7 + rnd() * 7, phase: rnd() * TAU });
    }
    return tufts;
  }

  moundTop(x) {
    const k = clamp(1 - Math.pow((2 * x) / MOUND.width, 2), 0, 1);
    return -Math.pow(k, 0.75) * MOUND.height + MOUND.height + Math.sin(x * 0.09) * 1.6 * k;
  }

  toScreen(x, y) {
    return { x: this.view.ox + x * this.view.scale, y: this.view.oy + y * this.view.scale };
  }

  growthOf(limb, p) {
    const t = clamp((p - limb.p0) / (limb.p1 - limb.p0));
    return t * (2 - t);
  }

  visibleTargets() {
    const p = this.shown;
    const list = [];
    for (const limb of this.tree.limbs) {
      if (limb.stiff) continue;
      const grown = this.growthOf(limb, p);
      if (grown < 0.2) continue;
      const point = limbPoint(limb, grown);
      list.push({ x: point.x, y: point.y });
    }
    if (!list.length) list.push({ x: 0, y: -8 - 30 * smooth(PHASE.sprout[0], PHASE.sprout[1], p) });
    return list;
  }

  spawnPetal(burst = false) {
    const flowers = this.tree.flowers;
    let flower = null;
    for (let tries = 0; tries < 6 && !flower; tries += 1) {
      const candidate = flowers[Math.floor(this.rnd() * flowers.length)];
      if (candidate.birth < this.shown) flower = candidate;
    }
    if (!flower) return;
    const at = attached(flower);
    this.petals.push({
      x: at.x, y: at.y,
      vx: burst ? (this.rnd() - 0.5) * 160 : 8 + this.rnd() * 18,
      vy: burst ? -40 - this.rnd() * 80 : 12 + this.rnd() * 14,
      rot: this.rnd() * TAU, vr: (this.rnd() - 0.5) * 3, size: 7 + this.rnd() * 4, phase: this.rnd() * TAU, life: 0,
    });
  }

  celebrate() {
    this.glow = 1;
    if (this.reduced) return;
    for (let i = 0; i < 70; i += 1) this.spawnPetal(true);
  }

  poke(x, y) {
    if (this.reduced) return;
    for (let i = 0; i < 8; i += 1) {
      this.petals.push({ x: x + (this.rnd() - 0.5) * 30, y: y + (this.rnd() - 0.5) * 20, vx: (this.rnd() - 0.5) * 40, vy: 10 + this.rnd() * 25, rot: this.rnd() * TAU, vr: (this.rnd() - 0.5) * 3, size: 7 + this.rnd() * 4, phase: this.rnd() * TAU, life: 0 });
    }
    this.energy = Math.min(1.5, this.energy + 0.4);
  }

  update(dt, growDt) {
    const gap = this.target - this.shown;
    if (this.reduced) {
      this.shown = this.target;
      this.introDone = true;
    } else {
      const tau = !this.introDone ? 0.7 : gap < 0 ? 0.45 : 1.1;
      this.shown += gap * (1 - Math.exp(-growDt / tau));
      if (Math.abs(gap) < 0.0005) {
        this.shown = this.target;
        this.introDone = true;
      }
    }
    this.energy *= Math.exp(-dt / 1.6);
    this.glow *= Math.exp(-dt / 1.4);

    // Final evresinde sürekli taç yaprağı / yaprak yağar.
    const bloom = smooth(0.8, 1, this.shown);
    if (!this.reduced && bloom > 0) {
      this.petalClock += dt * (bloom * 1.4 + (this.shown >= 0.999 ? 1 : 0));
      while (this.petalClock > 1) {
        this.petalClock -= 1;
        if (this.petals.length < 60) this.spawnPetal();
      }
    }

    for (const petal of this.petals) {
      petal.life += dt;
      petal.vy = Math.min(petal.vy + 30 * dt, 34);
      petal.vx *= Math.exp(-dt * 0.6);
      petal.x += (petal.vx + Math.sin(this.time * 1.6 + petal.phase) * 16) * dt;
      petal.y += petal.vy * dt;
      petal.rot += petal.vr * dt;
      if (petal.y >= this.moundTop(petal.x) - 2 && petal.vy > 0) {
        petal.landed = true;
        if (Math.abs(petal.x) < MOUND.width * 0.55 && this.groundPetals.length < 36) {
          this.groundPetals.push({ x: petal.x, y: this.moundTop(petal.x) - 1, rot: petal.rot, size: petal.size, age: 0 });
        }
      }
    }
    this.petals = this.petals.filter((petal) => !petal.landed && petal.life < 25);
    for (const petal of this.groundPetals) petal.age += dt;
    this.groundPetals = this.groundPetals.filter((petal) => petal.age < 40 && this.shown > 0.6);
  }

  // --- çizim -------------------------------------------------------------------

  treeTransform() {
    const { scale, ox, oy } = this.view;
    const d = this.dpr;
    this.ctx.setTransform(d * scale, 0, 0, d * scale, d * ox, d * oy);
  }

  spriteTransform(x, y, angle, scale = 1) {
    const view = this.view;
    const d = this.dpr;
    const k = d * view.scale * scale;
    const c = Math.cos(angle) * k;
    const s = Math.sin(angle) * k;
    this.ctx.setTransform(c, s, -s, c, d * (view.ox + x * view.scale), d * (view.oy + y * view.scale));
  }

  drawBlush() {
    const ctx = this.ctx;
    const { bounds } = this.tree;
    const center = this.toScreen((bounds.minX + bounds.maxX) / 2, bounds.minY * 0.55);
    const radius = (bounds.maxX - bounds.minX) * this.view.scale * 0.75;
    const [r, g, b] = this.theme.glow;
    const alpha = 0.18 + 0.3 * smooth(0.2, 1, this.shown);
    const gradient = ctx.createRadialGradient(center.x * this.dpr, center.y * this.dpr, 0, center.x * this.dpr, center.y * this.dpr, radius * this.dpr);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = gradient;
    ctx.fillRect((center.x - radius) * this.dpr, (center.y - radius) * this.dpr, radius * 2 * this.dpr, radius * 2 * this.dpr);
  }

  drawGround() {
    const ctx = this.ctx;
    const { width: mw, height: mh } = MOUND;
    ctx.fillStyle = 'rgba(166,128,88,.16)';
    ctx.beginPath();
    ctx.ellipse(0, mh * 1.02, mw * 1.25, mh * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(214,190,150,.35)';
    ctx.beginPath();
    ctx.ellipse(0, mh * 1.05, mw * 2.2, mh * 0.62, 0, 0, TAU);
    ctx.fill();

    const path = new Path2D();
    path.moveTo(-mw * 0.56, mh * 0.98);
    for (let i = 0; i <= 40; i += 1) {
      const x = lerp(-mw * 0.56, mw * 0.56, i / 40);
      path.lineTo(x, Math.min(mh * 0.98, this.moundTop(x)));
    }
    path.quadraticCurveTo(mw * 0.3, mh * 1.12, 0, mh * 1.12);
    path.quadraticCurveTo(-mw * 0.3, mh * 1.12, -mw * 0.56, mh * 0.98);
    path.closePath();
    const soil = ctx.createLinearGradient(0, 0, 0, mh * 1.1);
    soil.addColorStop(0, '#a87650');
    soil.addColorStop(1, '#7a4f33');
    ctx.fillStyle = soil;
    ctx.fill(path);
    ctx.strokeStyle = '#4c2f20';
    ctx.lineWidth = 2.2 / this.view.scale;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.fillStyle = 'rgba(196,146,104,.55)';
    for (const [x, y, r] of [[-62, 18, 9], [48, 20, 7], [-14, 26, 6], [86, 26, 5], [-96, 27, 5]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.5, r * 0.7, 0, 0, TAU);
      ctx.fill();
    }
    for (const [x, y, r] of [[-104, 30, 6], [96, 31, 5], [-80, 33, 4]]) {
      ctx.fillStyle = '#b9b2a6';
      ctx.strokeStyle = '#6f675c';
      ctx.lineWidth = 1.6 / this.view.scale;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.35, r, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawTufts(front) {
    const ctx = this.ctx;
    const wind = this.reduced ? 0 : Math.sin(this.time * 1.4);
    ctx.lineJoin = 'round';
    for (const tuft of this.tufts) {
      if (tuft.front !== front) continue;
      const baseY = this.moundTop(tuft.x) + 2;
      for (let b = 0; b < tuft.blades; b += 1) {
        const lean = (b - (tuft.blades - 1) / 2) * 0.45 + wind * 0.08 + Math.sin(tuft.phase) * 0.15;
        const h = tuft.height * (b % 2 ? 0.75 : 1);
        const x = tuft.x + (b - 1) * 3;
        ctx.beginPath();
        ctx.moveTo(x - 2.4, baseY);
        ctx.quadraticCurveTo(x + lean * h * 0.4, baseY - h * 0.6, x + lean * h, baseY - h);
        ctx.quadraticCurveTo(x + lean * h * 0.3 + 1, baseY - h * 0.5, x + 2.4, baseY);
        ctx.closePath();
        ctx.fillStyle = b % 2 ? '#86bb4f' : '#6fa843';
        ctx.fill();
        ctx.strokeStyle = '#3f6b2c';
        ctx.lineWidth = 1.4 / this.view.scale;
        ctx.stroke();
      }
    }
  }

  drawSeedAndSprout() {
    const ctx = this.ctx;
    const p = this.shown;
    const line = 2 / this.view.scale;
    const seedAlpha = 1 - smooth(0.02, 0.05, p);
    if (seedAlpha > 0) {
      ctx.globalAlpha = seedAlpha;
      ctx.fillStyle = '#8a5a35';
      ctx.strokeStyle = '#4c2f20';
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 6.5, -0.3, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const crack = smooth(PHASE.crack[0], PHASE.crack[1], p) * (1 - smooth(0.3, 0.45, p));
    if (crack > 0) {
      ctx.strokeStyle = 'rgba(76,47,32,.8)';
      ctx.lineWidth = 1.6 / this.view.scale;
      ctx.lineCap = 'round';
      for (const [dx, dy, ex, ey] of [[-4, 3, -26, 8], [4, 3, 24, 9], [0, 4, -8, 16], [2, 4, 12, 15]]) {
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(lerp(dx, ex, crack * 0.55), lerp(dy, ey, crack * 0.55) - 2);
        ctx.lineTo(lerp(dx, ex, crack), lerp(dy, ey, crack));
        ctx.stroke();
      }
    }
    const grow = smooth(PHASE.sprout[0], PHASE.sprout[1], p);
    const fade = 1 - smooth(PHASE.sproutFade[0], PHASE.sproutFade[1], p);
    if (grow <= 0 || fade <= 0) return;
    const sway = this.reduced ? 0 : Math.sin(this.time * 1.3) * 3 * grow;
    const h = 4 + 42 * easeOut(grow);
    const tipX = sway;
    const tipY = -h;
    ctx.globalAlpha = fade;
    ctx.lineCap = 'round';
    for (const [color, width] of [['#3f6b2c', 7.5], ['#86bb4f', 4.2]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.quadraticCurveTo(-4, -h * 0.5, tipX, tipY);
      ctx.stroke();
    }
    const open = smooth(0.035, 0.1, p);
    const size = 9 + 26 * grow;
    for (const side of [-1, 1]) {
      const angle = side * (0.25 + 0.95 * open) + sway * 0.02;
      const x = tipX + Math.sin(angle) * size * 0.45;
      const y = tipY - Math.cos(angle) * size * 0.45;
      this.spriteTransform(x, y, angle, size / 64);
      ctx.drawImage(this.sprites.leaves[side > 0 ? 1 : 0], -32, -32);
    }
    this.treeTransform();
    ctx.globalAlpha = 1;
  }

  // Dalı inceltilmiş bir şerit olarak çizer; extra > 0 ise kontur için genişletir.
  limbPath(limb, grown, girth, extra) {
    const m = grown * limb.n;
    const k = Math.floor(m);
    const fraction = m - k;
    const xs = [];
    const ys = [];
    const ws = [];
    for (let i = 0; i <= Math.min(k, limb.n); i += 1) {
      xs.push(limb.px[i]);
      ys.push(limb.py[i]);
      ws.push(i / limb.n);
    }
    if (fraction > 0.001 && k < limb.n) {
      xs.push(lerp(limb.px[k], limb.px[k + 1], fraction));
      ys.push(lerp(limb.py[k], limb.py[k + 1], fraction));
      ws.push(m / limb.n);
    }
    const count = xs.length;
    if (count < 2) return null;
    const left = [];
    const right = [];
    let tip = null;
    for (let j = 0; j < count; j += 1) {
      const a = Math.max(0, j - 1);
      const b = Math.min(count - 1, j + 1);
      let dx = xs[b] - xs[a];
      let dy = ys[b] - ys[a];
      const length = Math.hypot(dx, dy) || 1;
      dx /= length;
      dy /= length;
      const s = ws[j];
      let half = (lerp(limb.w0, limb.w1, s) * girth) / 2;
      if (grown < 1) half *= lerp(1, 0.55, Math.pow(s / grown, 3));
      if (limb.depth === 0 && s < 0.12) half *= 1 + (0.12 - s) * 2.2;
      half += extra;
      left.push([xs[j] - dy * half, ys[j] + dx * half]);
      right.push([xs[j] + dy * half, ys[j] - dx * half]);
      if (j === count - 1) tip = { x: xs[j], y: ys[j], r: half, angle: Math.atan2(dx, -dy) };
    }
    const path = new Path2D();
    path.moveTo(left[0][0], left[0][1]);
    for (let j = 1; j < count - 1; j += 1) {
      path.quadraticCurveTo(left[j][0], left[j][1], (left[j][0] + left[j + 1][0]) / 2, (left[j][1] + left[j + 1][1]) / 2);
    }
    path.lineTo(left[count - 1][0], left[count - 1][1]);
    path.arc(tip.x, tip.y, tip.r, tip.angle, tip.angle - Math.PI, true);
    for (let j = count - 2; j > 0; j -= 1) {
      path.quadraticCurveTo(right[j][0], right[j][1], (right[j][0] + right[j - 1][0]) / 2, (right[j][1] + right[j - 1][1]) / 2);
    }
    path.lineTo(right[0][0], right[0][1]);
    path.closePath();
    return path;
  }

  drawWood() {
    const ctx = this.ctx;
    const p = this.shown;
    const age = smooth(0.08, 0.3, p);
    const girth = lerp(0.4, 1, smooth(PHASE.girth[0], PHASE.girth[1], p));
    const outline = 2.4 / this.view.scale;
    const { young, mature } = this.theme.bark;
    const visible = [];
    for (const limb of this.tree.limbs) {
      const grown = this.growthOf(limb, p);
      if (grown <= 0.002) continue;
      const path = this.limbPath(limb, grown, girth, 0);
      if (!path) continue;
      visible.push({ limb, grown, path, outer: this.limbPath(limb, grown, girth, outline) });
    }
    ctx.fillStyle = mix(young[0], mature[0], age);
    for (const item of visible) ctx.fill(item.outer);
    ctx.fillStyle = mix(young[1], mature[1], age);
    for (const item of visible) ctx.fill(item.path);

    // Işık ve gölge şeritleri
    ctx.lineCap = 'round';
    for (const [shift, widthRatio, color] of [[0.2, 0.32, mix(young[2], mature[2], age)], [-0.2, 0.26, mix(young[3], mature[3], age)]]) {
      ctx.strokeStyle = color;
      for (const { limb, grown } of visible) {
        const segments = Math.floor(grown * limb.n);
        for (let i = 0; i < segments; i += 1) {
          const s = (i + 0.5) / limb.n;
          const half = (lerp(limb.w0, limb.w1, s) * girth) / 2;
          if (half < 1.5) continue;
          const a = limb.pa[i];
          const nx = -Math.sin(a) * half * shift * 2;
          const ny = Math.cos(a) * half * shift * 2;
          ctx.lineWidth = half * 2 * widthRatio;
          ctx.beginPath();
          ctx.moveTo(limb.px[i] + nx, limb.py[i] + ny);
          ctx.lineTo(limb.px[i + 1] + nx, limb.py[i + 1] + ny);
          ctx.stroke();
        }
      }
    }
    // Kabuk çizgileri
    ctx.strokeStyle = 'rgba(60,38,28,.5)';
    ctx.lineWidth = 1.5 / this.view.scale;
    for (const { limb, grown } of visible) {
      if (!limb.marks.length || age < 0.5) continue;
      for (const mark of limb.marks) {
        if (mark.s1 > grown) continue;
        ctx.beginPath();
        for (let step = 0; step <= 8; step += 1) {
          const s = lerp(mark.s0, mark.s1, step / 8);
          const point = limbPoint(limb, s);
          const half = (lerp(limb.w0, limb.w1, s) * girth) / 2;
          const offset = (mark.offset + Math.sin(s * Math.PI * mark.twist) * 0.22) * half * 2;
          const x = point.x - Math.sin(point.a) * offset;
          const y = point.y + Math.cos(point.a) * offset;
          if (step) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    }
  }

  drawCanopy() {
    const p = this.shown;
    if (p < PHASE.canopy[0]) return;
    const ctx = this.ctx;
    const outline = 2.2 / this.view.scale;
    const colors = this.theme.canopy;
    const items = [];
    for (const blob of this.tree.blobs) {
      const amount = easeBack(clamp((p - blob.birth) / 0.06));
      if (amount <= 0) continue;
      const at = attached(blob);
      items.push({ x: at.x, y: at.y, r: blob.r * amount });
    }
    // Önce tüm konturlar, sonra dolgular: daireler tek bir bulut gibi birleşir.
    for (const [color, grow, shift, ratio] of [[colors.outline, outline, 0, 1], [colors.fill, 0, 0, 1], [colors.light, 0, 1, 0.72]]) {
      ctx.fillStyle = color;
      for (const item of items) {
        ctx.beginPath();
        ctx.arc(item.x - item.r * 0.12 * shift, item.y - item.r * 0.16 * shift, item.r * ratio + grow, 0, TAU);
        ctx.fill();
      }
    }
  }

  // Fidan ve dallanma evrelerinde büyüyen dal uçlarında taze yaprak çifti.
  drawTipLeaves() {
    const p = this.shown;
    const fade = 1 - smooth(0.5, 0.64, p);
    if (fade <= 0 || p < PHASE.wood[0] + 0.01) return;
    const ctx = this.ctx;
    const wind = this.reduced ? 0 : 1;
    for (const limb of this.tree.limbs) {
      if (limb.stiff || limb.depth > 2) continue;
      const grown = this.growthOf(limb, p);
      if (grown < 0.08) continue;
      if (limb.children.some((child) => !child.stiff && this.growthOf(child, p) > 0.25)) continue;
      const tip = limbPoint(limb, grown);
      const size = (13 + 9 * Math.min(1, grown * 1.4)) * fade;
      for (const side of [-1, 1]) {
        const angle = tip.a + side * 0.62 + Math.sin(this.time * 2.1 + limb.phase + side) * 0.1 * wind;
        this.spriteTransform(tip.x + Math.cos(angle) * size * 0.42, tip.y + Math.sin(angle) * size * 0.42, angle + Math.PI / 2, size / 64);
        ctx.drawImage(this.sprites.leaves[side > 0 ? 1 : 0], -32, -32);
      }
    }
    this.treeTransform();
  }

  drawLeaves() {
    const p = this.shown;
    const ctx = this.ctx;
    const fade = 1 - smooth(PHASE.leafFade[0], PHASE.leafFade[1], p) * 0.6;
    const wind = this.reduced ? 0 : 1;
    for (const leaf of this.tree.leaves) {
      const amount = easeBack(clamp((p - leaf.birth) / 0.035));
      if (amount <= 0) continue;
      const point = limbPoint(leaf.limb, leaf.u);
      const angle = point.a + leaf.angle + Math.sin(this.time * 2 + leaf.phase) * 0.12 * wind;
      const size = leaf.size * amount;
      const x = point.x + Math.cos(angle) * size * 0.45;
      const y = point.y + Math.sin(angle) * size * 0.45;
      ctx.globalAlpha = fade;
      this.spriteTransform(x, y, angle + Math.PI / 2, size / 64);
      ctx.drawImage(this.sprites.leaves[leaf.tint], -32, -32);
    }
    ctx.globalAlpha = 1;
    this.treeTransform();
  }

  drawFlowers() {
    const p = this.shown;
    const ctx = this.ctx;
    const wind = this.reduced ? 0 : 1;
    for (const flower of this.tree.flowers) {
      const budStart = flower.birth - PHASE.budLead;
      if (p < budStart) break;
      const at = attached(flower);
      const bloom = clamp((p - flower.birth) / 0.018);
      const wiggle = Math.sin(this.time * 1.7 + flower.phase) * 0.08 * wind;
      if (bloom < 1) {
        const bud = easeOut(clamp((p - budStart) / 0.03)) * (1 - bloom);
        if (bud > 0.02) {
          const size = flower.size * 0.55 * bud;
          this.spriteTransform(at.x, at.y, at.a + Math.PI / 2 + wiggle, size / 48);
          ctx.drawImage(this.sprites.bud, -24, -24);
        }
      }
      if (bloom > 0) {
        const size = flower.size * easeBack(bloom);
        this.spriteTransform(at.x, at.y, flower.rot + wiggle, size / 96);
        ctx.drawImage(this.sprites.blossoms[flower.tint], -48, -48);
      }
    }
    this.treeTransform();
  }

  drawPetals(list, alphaOf) {
    const ctx = this.ctx;
    const maple = this.theme.petal.shape === 'maple';
    for (const petal of list) {
      const alpha = alphaOf(petal);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      this.spriteTransform(petal.x, petal.y, petal.rot, (petal.size * (maple ? 1.3 : 1)) / 40);
      ctx.drawImage(this.sprites.petal, -20, maple ? -20 : -36);
    }
    ctx.globalAlpha = 1;
    this.treeTransform();
  }

  draw() {
    this.drawBlush();
    // Rüzgâr: yavaş temel salınım + ara sıra esinti + token akışında canlanma.
    const t = this.time + this.theme.seed % 7;
    const wind = this.reduced ? 0 : 0.7 + 0.3 * Math.sin(t * 0.21) + Math.pow(Math.max(0, Math.sin(t * 0.53)), 3) * 0.4 + this.energy * 0.9;
    for (const limb of this.tree.limbs) poseLimb(limb, this.time, wind);

    this.treeTransform();
    this.drawGround();
    this.drawTufts(false);
    this.drawPetals(this.groundPetals, (petal) => Math.min(1, (40 - petal.age) / 6) * 0.9);
    this.drawCanopy();
    this.drawWood();
    this.drawSeedAndSprout();
    this.drawTufts(true);
    this.drawTipLeaves();
    this.drawLeaves();
    this.drawFlowers();
    this.drawPetals(this.petals, (petal) => Math.min(1, petal.life * 3));
  }
}

// ---------------------------------------------------------------------------
// Bahçe sahnesi: arka plan, yerleşim, ışık taneleri, etiketler

export class GardenScene {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.win = window;
    this.reduced = reducedMotion;
    this.plants = new Map();
    this.order = [];
    this.focus = null;
    this.labels = true;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.feedOrigin = null;
    this.motes = [];
    this.sparks = [];
    this.rnd = mulberry32(99);
    this.time = 0;
    this.last = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.running = false;
    this.frame = this.frame.bind(this);
  }

  // Sahneyi başka bir pencerede (Picture-in-Picture) çizmek için.
  setWindow(win) {
    this.win = win;
    if (this.running) win.requestAnimationFrame(this.frame);
  }

  setInsets(insets) {
    this.insets = { ...this.insets, ...insets };
  }

  setFeedOrigin(point) {
    this.feedOrigin = point;
  }

  setFocus(id) {
    this.focus = id;
  }

  // trees: [{ id, progress }] — gösterilecek ağaçlar, soldan sağa.
  setTrees(trees, { instant = false } = {}) {
    const ids = trees.map((tree) => tree.id);
    for (const id of [...this.plants.keys()]) if (!ids.includes(id)) this.plants.delete(id);
    for (const tree of trees) {
      if (!this.plants.has(tree.id)) this.plants.set(tree.id, new Plant(this, tree.id));
      this.plants.get(tree.id).setProgress(tree.progress, instant || this.reduced);
    }
    this.order = ids;
  }

  plant(id) {
    return this.plants.get(id) || this.plants.get(this.order[0]);
  }

  pulse(id, amount) {
    const plant = this.plant(id);
    if (!plant || !plant.introDone) return;
    plant.energy = Math.min(1.5, plant.energy + 0.25 + Math.log10(1 + amount) * 0.08);
    if (this.reduced) return;
    const count = clamp(Math.round(Math.log2(1 + amount / 400)), 1, 12);
    for (let i = 0; i < count; i += 1) this.spawnMote(plant, i * 0.08);
  }

  celebrate(id) {
    this.plant(id)?.celebrate();
  }

  poke(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = null;
    for (const plant of this.plants.values()) {
      if (!plant.view) continue;
      const distance = Math.abs(plant.view.ox - x);
      if (!best || distance < best.distance) best = { plant, distance };
    }
    if (!best) return;
    const { plant } = best;
    plant.poke((x - plant.view.ox) / plant.view.scale, (clientY - rect.top - plant.view.oy) / plant.view.scale);
  }

  // Işık tanesi: harcanan tokenları temsil eder; panelden çıkıp ağaçtaki bir noktaya uçar.
  spawnMote(plant, delay = 0) {
    const targets = plant.visibleTargets();
    const target = targets[Math.floor(this.rnd() * targets.length)] || { x: 0, y: -10 };
    const origin = this.feedOrigin || { x: this.width * (0.25 + this.rnd() * 0.5), y: -10 };
    this.motes.push({
      plant, sx: origin.x + (this.rnd() - 0.5) * 40, sy: origin.y + (this.rnd() - 0.5) * 10,
      tx: target.x, ty: target.y, bend: (this.rnd() - 0.5) * 220,
      t: -delay, duration: 1.1 + this.rnd() * 0.7, size: 14 + this.rnd() * 10,
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.win.requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  measure() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const dpr = Math.min(2, this.win.devicePixelRatio || 1);
    if (width !== this.width || height !== this.height || dpr !== this.dpr) {
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(width * dpr));
      this.canvas.height = Math.max(1, Math.round(height * dpr));
      this.background = null;
    }
  }

  frame(now) {
    if (!this.running) return;
    this.win.requestAnimationFrame(this.frame);
    // Fizik için adım kısıtlanır; büyüme yumuşatması ise yavaş karelerde de gerçek zamanı izler.
    const raw = this.last ? (now - this.last) / 1000 : 0.016;
    const dt = Math.min(0.05, raw);
    this.last = now;
    this.time += dt;
    this.measure();
    if (!this.width || !this.height) return;
    for (const plant of this.plants.values()) plant.update(dt, Math.min(0.5, raw));
    for (const mote of this.motes) {
      mote.t += dt / mote.duration;
      if (mote.t >= 1 && !mote.done) {
        mote.done = true;
        this.sparks.push({ plant: mote.plant, x: mote.tx, y: mote.ty, t: 0 });
      }
    }
    this.motes = this.motes.filter((mote) => !mote.done && this.plants.has(mote.plant.id));
    for (const spark of this.sparks) spark.t += dt / 0.55;
    this.sparks = this.sparks.filter((spark) => spark.t < 1 && this.plants.has(spark.plant.id));
    this.layout(dt);
    this.draw();
  }

  // Ağaçları yan yana sütunlara yerleştirir; hepsi aynı ölçekte çizilir.
  layout(dt) {
    const plants = this.order.map((id) => this.plants.get(id)).filter(Boolean);
    const count = Math.max(1, plants.length);
    const single = count === 1;
    const { top, right, bottom, left } = this.insets;
    const labelSpace = !single && this.labels ? 30 : 0;
    const availW = Math.max(120, this.width - left - right);
    const availH = Math.max(120, this.height - top - bottom - labelSpace);
    const column = availW / count;
    let fit = Infinity;
    for (const plant of plants) {
      const { minX, maxX, minY } = plant.tree.bounds;
      fit = Math.min(fit, (column - 8) / (maxX - minX + 24), availH / (-minY + MOUND.height * 1.15 + 12));
    }
    const groundY = top + availH - 4;
    plants.forEach((plant, index) => {
      const targetX = left + column * (index + 0.5);
      plant.cx = plant.cx === null || this.reduced ? targetX : lerp(plant.cx, targetX, 1 - Math.exp(-dt / 0.35));
      // Tek ağaçta erken evrelerde kamera tohuma yakınlaşır.
      const settle = single && !this.reduced ? smooth(0, 0.42, plant.shown) : 1;
      const zoom = lerp(single ? 1.9 : 1, 1, settle);
      const scale = fit * zoom;
      const { minX, maxX } = plant.tree.bounds;
      const shift = ((minX + maxX) / 2) * scale * settle;
      plant.view = { scale, ox: plant.cx - shift, oy: groundY - MOUND.height * 1.12 * scale, groundY };
    });
    this.labelY = groundY + 20;
  }

  drawBackground() {
    if (!this.background || this.background.width !== this.canvas.width || this.background.height !== this.canvas.height) {
      const bg = document.createElement('canvas');
      bg.width = this.canvas.width;
      bg.height = this.canvas.height;
      const ctx = bg.getContext('2d');
      const w = bg.width;
      const h = bg.height;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#fdf6ec');
      sky.addColorStop(0.62, '#fbefe0');
      sky.addColorStop(1, '#f3e2c8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      const sun = ctx.createRadialGradient(w * 0.78, h * 0.16, 0, w * 0.78, h * 0.16, Math.max(w, h) * 0.32);
      sun.addColorStop(0, 'rgba(255,233,190,.75)');
      sun.addColorStop(1, 'rgba(255,233,190,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);
      this.background = bg;
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.background, 0, 0);
  }

  drawMotes() {
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.globalCompositeOperation = 'lighter';
    for (const mote of this.motes) {
      if (mote.t <= 0 || !mote.plant.view) continue;
      const end = mote.plant.toScreen(mote.tx, mote.ty);
      for (let trail = 0; trail < 4; trail += 1) {
        const t = clamp(mote.t - trail * 0.035);
        const e = t * t * (3 - 2 * t);
        const cx = (mote.sx + end.x) / 2 + mote.bend;
        const cy = Math.min(mote.sy, end.y) - 80;
        const x = (1 - e) * (1 - e) * mote.sx + 2 * (1 - e) * e * cx + e * e * end.x;
        const y = (1 - e) * (1 - e) * mote.sy + 2 * (1 - e) * e * cy + e * e * end.y;
        const size = mote.size * (1 - trail * 0.22);
        ctx.globalAlpha = (1 - trail * 0.25) * Math.min(1, mote.t * 5);
        ctx.setTransform(d, 0, 0, d, d * x, d * y);
        ctx.drawImage(mote.plant.sprites.glow, -size / 2, -size / 2, size, size);
      }
    }
    for (const spark of this.sparks) {
      if (!spark.plant.view) continue;
      const point = spark.plant.toScreen(spark.x, spark.y);
      const size = 18 + spark.t * 40;
      ctx.globalAlpha = 1 - spark.t;
      ctx.setTransform(d, 0, 0, d, d * point.x, d * point.y);
      ctx.drawImage(spark.plant.sprites.glow, -size / 2, -size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawLabels() {
    if (this.order.length < 2 || !this.labels) return;
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const id of this.order) {
      const plant = this.plants.get(id);
      if (!plant?.view) continue;
      const focused = id === this.focus;
      const name = `${plant.theme.ai} · ${plant.theme.species}`;
      const percent = `${Math.min(100, Math.floor(plant.target * 100))}%`;
      ctx.font = `${focused ? 700 : 600} 12.5px "Segoe UI", system-ui, sans-serif`;
      const nameWidth = ctx.measureText(name).width;
      ctx.font = '800 12.5px "Segoe UI", system-ui, sans-serif';
      const pctWidth = ctx.measureText(percent).width;
      const total = nameWidth + 8 + pctWidth;
      const x = plant.cx - total / 2;
      const y = this.labelY;
      ctx.fillStyle = focused ? 'rgba(255,251,246,.95)' : 'rgba(255,251,246,.7)';
      ctx.beginPath();
      ctx.roundRect(x - 11, y - 12, total + 22, 24, 12);
      ctx.fill();
      if (focused) {
        ctx.strokeStyle = plant.theme.accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.textAlign = 'left';
      ctx.font = `${focused ? 700 : 600} 12.5px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = '#5d4639';
      ctx.fillText(name, x, y + 0.5);
      ctx.font = '800 12.5px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = plant.theme.accentDeep;
      ctx.fillText(percent, x + nameWidth + 8, y + 0.5);
    }
  }

  draw() {
    this.drawBackground();
    for (const id of this.order) this.plants.get(id)?.draw();
    this.drawMotes();
    this.drawLabels();
    const glow = Math.max(0, ...[...this.plants.values()].map((plant) => plant.glow));
    if (glow > 0.01) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.fillStyle = `rgba(255,236,200,${glow * 0.22})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

export { PHASE };
