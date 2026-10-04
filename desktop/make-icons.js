'use strict';
// Uygulama ve tepsi ikonlarını üretir: npx electron desktop/make-icons.js
// SVG'ler kodla çizilir, Electron'un ekran dışı (offscreen) çiziciyle şeffaf PNG'ye çevrilir.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, 'assets');
const BUILD = path.join(__dirname, '..', 'build');

const round = (value) => Math.round(value * 10) / 10;

function blossom(cx, cy, r, stroke) {
  const petal = `M0 0 C${round(-0.62 * r)} ${round(-0.22 * r)} ${round(-0.7 * r)} ${round(-0.86 * r)} ${round(-0.2 * r)} ${round(-r)} L0 ${round(-0.84 * r)} L${round(0.2 * r)} ${round(-r)} C${round(0.7 * r)} ${round(-0.86 * r)} ${round(0.62 * r)} ${round(-0.22 * r)} 0 0Z`;
  const petals = [0, 72, 144, 216, 288].map((angle) => `<path d="${petal}" transform="rotate(${angle})"/>`).join('');
  return `<g transform="translate(${cx} ${cy})">
    <g fill="url(#petal)" stroke="#c4507a" stroke-width="${stroke}" stroke-linejoin="round">${petals}</g>
    <circle r="${round(r * 0.16)}" fill="#f6cf63" stroke="#d9963a" stroke-width="${round(stroke * 0.6)}"/>
  </g>`;
}

function maple(cx, cy, r, rotate, stroke) {
  const lobes = [[-152, 0.84], [-90, 1], [-28, 0.84], [32, 0.56], [148, 0.56]];
  const polar = (deg, radius) => `${round(Math.cos((deg * Math.PI) / 180) * radius * r)},${round(Math.sin((deg * Math.PI) / 180) * radius * r)}`;
  const points = [];
  lobes.forEach(([angle, length], index) => {
    const [next] = lobes[(index + 1) % lobes.length];
    const span = (next - angle + 360) % 360;
    points.push(polar(angle - 20, length * 0.5), polar(angle - 11, length * 0.74), polar(angle - 6, length * 0.66), polar(angle, length),
      polar(angle + 6, length * 0.66), polar(angle + 11, length * 0.74), polar(angle + 20, length * 0.5), polar(angle + span / 2, span > 100 ? 0.2 : 0.32));
  });
  return `<g transform="translate(${cx} ${cy}) rotate(${rotate})">
    <path d="M0 ${round(r * 0.1)} Q${round(r * 0.06)} ${round(r * 0.5)} ${round(-r * 0.04)} ${round(r * 0.85)}" stroke="#93301d" stroke-width="${stroke}" stroke-linecap="round" fill="none"/>
    <polygon points="${points.join(' ')}" fill="url(#maple)" stroke="#93301d" stroke-width="${stroke}" stroke-linejoin="round"/>
  </g>`;
}

// Erik (ume) çiçeği: yuvarlak taç yapraklar, uzun ercikler. Tarayıcı eklentisinin simgesi.
function ume(cx, cy, r, stroke) {
  const petal = `M0 0 C${round(-0.78 * r)} ${round(-0.28 * r)} ${round(-0.74 * r)} ${round(-1.04 * r)} 0 ${round(-r)} C${round(0.74 * r)} ${round(-1.04 * r)} ${round(0.78 * r)} ${round(-0.28 * r)} 0 0Z`;
  const petals = [0, 72, 144, 216, 288].map((angle) => `<path d="${petal}" transform="rotate(${angle})"/>`).join('');
  const stamens = Array.from({ length: 11 }, (_, index) => {
    const angle = (index / 11) * Math.PI * 2 + 0.3;
    const x = round(Math.cos(angle) * r * 0.5);
    const y = round(Math.sin(angle) * r * 0.5);
    return `<line x2="${x}" y2="${y}"/><circle cx="${x}" cy="${y}" r="${round(r * 0.07)}" fill="#efb12f" stroke="none"/>`;
  }).join('');
  return `<g transform="translate(${cx} ${cy})">
    <g fill="url(#ume)" stroke="#a92c50" stroke-width="${stroke}" stroke-linejoin="round">${petals}</g>
    <g stroke="#e9c46a" stroke-width="${round(stroke * 0.5)}" stroke-linecap="round">${stamens}</g>
    <circle r="${round(r * 0.14)}" fill="#b7cf62" stroke="#7d8f3a" stroke-width="${round(stroke * 0.4)}"/>
  </g>`;
}

const defs = `<defs>
  <radialGradient id="ume" cx="0.5" cy="0.5" r="0.62"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#ffc2d0"/><stop offset="1" stop-color="#e5507a"/></radialGradient>
  <radialGradient id="petal" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#fffafc"/><stop offset="0.5" stop-color="#ffc6d7"/><stop offset="1" stop-color="#f08fb0"/></radialGradient>
  <radialGradient id="maple" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#ffd08a"/><stop offset="0.5" stop-color="#f4893c"/><stop offset="1" stop-color="#d9472b"/></radialGradient>
  <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7ee"/><stop offset="1" stop-color="#fbdbe4"/></linearGradient>
</defs>`;

const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#tile)" stroke="#e7b9c6" stroke-width="6"/>
  <ellipse cx="256" cy="420" rx="150" ry="26" fill="#e9c9a6" opacity=".6"/>
  ${blossom(214, 218, 138, 11)}
  ${maple(358, 352, 112, 16, 8)}
</svg>`;

const trayIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}${blossom(32, 32, 30, 4.5)}</svg>`;
const browserIcon = (stroke) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}${ume(32, 32, 30, stroke)}</svg>`;
const EXTENSION = path.join(__dirname, '..', 'browser-extension', 'icons');
// --browser: yalnızca tarayıcı eklentisinin simgeleri (uygulama ikonlarına dokunmaz).
const browserOnly = process.argv.includes('--browser');

function render(svg, size) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ width: size, height: size, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
    win.webContents.setFrameRate(10);
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
    let done = false;
    win.webContents.on('paint', (_event, _dirty, image) => {
      if (done) return;
      const bitmap = image.resize({ width: size, height: size });
      if (bitmap.isEmpty()) return;
      done = true;
      resolve(bitmap.toPNG());
      setTimeout(() => win.destroy(), 50);
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(reject);
    setTimeout(() => !done && reject(new Error('render timeout')), 8000);
  });
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(EXTENSION, { recursive: true });
  // Küçük boyutlarda çizgi kalınlaşır ki 16 piksellik araç çubuğu simgesi seçilebilsin.
  const outputs = [16, 32, 48, 128].map((size) => [browserIcon(size <= 32 ? 4.5 : 3), size, path.join(EXTENSION, `icon-${size}.png`)]);
  if (!browserOnly) {
    fs.writeFileSync(path.join(OUT, 'icon.svg'), appIcon);
    fs.writeFileSync(path.join(__dirname, '..', 'public', 'icon.svg'), appIcon);
    outputs.push(
      [appIcon, 512, path.join(BUILD, 'icon.png')],
      [appIcon, 256, path.join(OUT, 'icon.png')],
      [trayIcon, 16, path.join(OUT, 'tray.png')],
      [trayIcon, 32, path.join(OUT, 'tray@2x.png')],
    );
  }
  for (const [svg, size, file] of outputs) {
    fs.writeFileSync(file, await render(svg, size));
    console.log('✓', path.relative(path.join(__dirname, '..'), file), `${size}px`);
  }
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
