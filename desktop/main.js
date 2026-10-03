'use strict';
// Sakura Token Bahçesi — masaüstü uygulaması (Electron).
// Sunucuyu kendi içinde çalıştırır; ana pencere, her zaman üstte widget ve sistem tepsisi sunar.

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, screen, shell } = require('electron');
const { SakuraServer } = require('../lib/app-server');
const { appDataDir } = require('../lib/paths');

const APP_NAME = 'Sakura Token Bahçesi';
const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(__dirname, 'assets');
const AI = {
  claude: { name: 'Claude Code', species: 'Sakura', emoji: '🌸', finale: 'Hanami' },
  codex: { name: 'Codex', species: 'Momiji', emoji: '🍁', finale: 'Momijigari' },
  vscode: { name: 'VS Code', species: 'Fuji', emoji: '🪻', finale: 'Fujimatsuri', lines: true },
};

const startHidden = process.argv.includes('--hidden');
const demo = process.argv.includes('--demo');

let server = null;
let baseUrl = '';
let mainWindow = null;
let widgetWindow = null;
let tray = null;
let quitting = false;
let prefs = {};
let lastSnapshot = null;
const finished = new Set();

// --- Tercihler --------------------------------------------------------------

const prefsFile = () => path.join(app.getPath('userData'), 'desktop.json');

function loadPrefs() {
  try {
    prefs = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
  } catch {
    prefs = {};
  }
  prefs = { widgetOnTop: true, widgetVisible: false, hintShown: false, ...prefs };
}

let saveTimer = null;
function savePrefs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
      fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
    } catch {
      // Tercih kaydedilemezse uygulama yine çalışır.
    }
  }, 300);
}

// --- Pencereler ----------------------------------------------------------------

const icon = () => nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));

function secure(win) {
  // Uygulama yalnızca kendi yerel sunucusunu gösterir; dış bağlantılar tarayıcıda açılır.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(baseUrl)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) event.preventDefault();
  });
}

const webPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: true,
});

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 420,
    minHeight: 560,
    title: APP_NAME,
    icon: icon(),
    backgroundColor: '#fbf1e4',
    autoHideMenuBar: true,
    show: false,
    webPreferences: webPreferences(),
  });
  secure(mainWindow);
  mainWindow.loadURL(`${baseUrl}/`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (quitting) return;
    // Kapatınca tepsiye küçülür; ajanlar çalışırken ağaç büyümeye devam eder.
    event.preventDefault();
    mainWindow.hide();
    if (!prefs.hintShown && Notification.isSupported()) {
      new Notification({ title: APP_NAME, body: 'Uygulama sistem tepsisinde çalışmaya devam ediyor. Çıkmak için tepsideki 🌸 simgesine sağ tıkla.', icon: icon() }).show();
      prefs.hintShown = true;
      savePrefs();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (lastSnapshot) updateTaskbar(lastSnapshot);
}

function showMain() {
  if (!mainWindow) createMain();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// macOS'ta "floating" seviyesi gerekir. Windows'ta seviye verilirse ya da Electron bayrağı
// zaten açık sanıyorsa uygulanmıyor; önce kapatıp sonra açmak her durumda çalışıyor.
function pinOnTop(win, onTop) {
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(onTop, 'floating');
    return;
  }
  win.setAlwaysOnTop(false);
  if (onTop) win.setAlwaysOnTop(true);
}

function defaultWidgetBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 340;
  const height = 470;
  return { width, height, x: area.x + area.width - width - 24, y: area.y + area.height - height - 24 };
}

function visibleOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) => bounds.x < a.x + a.width - 40 && bounds.x + bounds.width > a.x + 40 && bounds.y >= a.y - 10 && bounds.y < a.y + a.height - 40);
}

function createWidget() {
  const bounds = prefs.widgetBounds && visibleOnSomeDisplay(prefs.widgetBounds) ? prefs.widgetBounds : defaultWidgetBounds();
  widgetWindow = new BrowserWindow({
    ...bounds,
    minWidth: 240,
    minHeight: 300,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: `${APP_NAME} — Widget`,
    icon: icon(),
    backgroundColor: '#fbf1e4',
    show: false,
    webPreferences: webPreferences(),
  });
  secure(widgetWindow);
  widgetWindow.loadURL(`${baseUrl}/?mode=widget`);
  widgetWindow.once('ready-to-show', () => {
    widgetWindow.showInactive();
    // Windows'ta bayrak, pencere ekrana yerleştikten sonra uygulanınca tutuyor.
    setTimeout(() => widgetWindow && !widgetWindow.isDestroyed() && pinOnTop(widgetWindow, prefs.widgetOnTop), 250);
  });
  const remember = () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    prefs.widgetBounds = widgetWindow.getBounds();
    savePrefs();
  };
  widgetWindow.on('moved', remember);
  widgetWindow.on('resized', remember);
  widgetWindow.on('closed', () => {
    widgetWindow = null;
    refreshTray();
  });
}

function setWidgetVisible(visible) {
  prefs.widgetVisible = visible;
  savePrefs();
  if (visible) {
    if (!widgetWindow) createWidget();
    else {
      widgetWindow.showInactive();
      setTimeout(() => widgetWindow && pinOnTop(widgetWindow, prefs.widgetOnTop), 250);
    }
  } else if (widgetWindow) {
    widgetWindow.close();
  }
  refreshTray();
}

function setWidgetOnTop(onTop) {
  prefs.widgetOnTop = onTop;
  savePrefs();
  if (widgetWindow) pinOnTop(widgetWindow, onTop);
  refreshTray();
}

// --- Sistem tepsisi --------------------------------------------------------------

function trayTooltip(snap) {
  if (!snap || !snap.trees) return APP_NAME;
  const parts = snap.trees.map((tree) => {
    const ai = AI[tree.id] || { emoji: '🌱', species: tree.id };
    return `${ai.emoji} ${ai.species} %${Math.min(100, Math.floor(tree.progress * 100))}`;
  });
  return `${APP_NAME}\n${parts.join(' · ')}`;
}

function refreshTray() {
  if (!tray) return;
  const openAtLogin = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Bahçeyi aç', click: showMain },
    { label: 'Widget', type: 'checkbox', checked: !!widgetWindow, click: (item) => setWidgetVisible(item.checked) },
    { label: 'Widget her zaman üstte', type: 'checkbox', checked: prefs.widgetOnTop, click: (item) => setWidgetOnTop(item.checked) },
    { type: 'separator' },
    {
      label: 'Windows açılışında başlat',
      type: 'checkbox',
      checked: openAtLogin,
      enabled: app.isPackaged,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
        refreshTray();
      },
    },
    { type: 'separator' },
    { label: 'Çıkış', click: quit },
  ]));
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else showMain();
  });
  refreshTray();
}

// --- Canlı veri: görev çubuğu ilerlemesi, tepsi ipucu, bildirim ------------------------

function focusTree(snap) {
  return snap.trees.find((tree) => tree.id === snap.focus) || snap.trees[0];
}

function updateTaskbar(snap) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const tree = focusTree(snap);
  mainWindow.setProgressBar(tree && tree.progress > 0 ? Math.min(1, tree.progress) : -1);
  const ai = AI[tree?.id];
  if (ai) mainWindow.setTitle(`${ai.species} %${Math.min(100, Math.floor(tree.progress * 100))} — ${APP_NAME}`);
}

function onSnapshot(snap) {
  if (!snap.ready) return;
  const first = !lastSnapshot;
  lastSnapshot = snap;
  updateTaskbar(snap);
  if (tray) tray.setToolTip(trayTooltip(snap));
  for (const tree of snap.trees) {
    const key = `${snap.season.key}:${tree.id}:${tree.unit === 'lines' ? snap.settings.codeTarget : snap.settings.target}`;
    if (tree.progress < 1 || finished.has(key)) continue;
    finished.add(key);
    // Açılışta zaten tamamlanmış ağaçlar için bildirim gösterilmez.
    if (first || !Notification.isSupported()) continue;
    const ai = AI[tree.id] || { emoji: '🌳', finale: 'Tamamlandı', name: tree.id };
    const reason = ai.lines ? "VS Code'da elle yazdığın satırlar kod hedefine ulaştı." : `${ai.name} token hedefini tamamladı.`;
    const body = `${reason} ${ai.species} ağacını bahçeye dikebilirsin.`;
    new Notification({ title: `${ai.emoji} ${ai.finale}!`, body, icon: icon() }).show();
  }
}

// --- Uygulama yaşam döngüsü ----------------------------------------------------------

async function quit() {
  quitting = true;
  if (server) await server.stop();
  app.quit();
}

// Geliştirme öz-testi: SAKURA_SELFTEST=<klasör> ile açılır, iki pencerenin ekran
// görüntüsünü ve durum özetini kaydedip kapanır.
async function selfTest(dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (!widgetWindow) setWidgetVisible(true);
  await new Promise((resolve) => setTimeout(resolve, 7000));
  for (const [name, win] of [['main', mainWindow], ['widget', widgetWindow]]) {
    if (!win) continue;
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
  }
  const snap = lastSnapshot || server.snapshot();
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    url: baseUrl,
    trees: snap.trees,
    focus: snap.focus,
    value: snap.value,
    tray: trayTooltip(snap),
    title: mainWindow?.getTitle(),
    widgetOnTop: widgetWindow?.isAlwaysOnTop(),
    widgetBounds: widgetWindow?.getBounds(),
  }, null, 2));
  await quit();
}

ipcMain.on('sakura:toggle-widget', () => setWidgetVisible(!widgetWindow));
ipcMain.on('sakura:open-main', showMain);
ipcMain.on('sakura:quit', quit);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMain);
  app.setAppUserModelId('com.sakura.tokengarden');

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    loadPrefs();
    server = new SakuraServer({
      port: demo ? 4890 : 4875,
      demo,
      desktop: true,
      publicDir: path.join(ROOT, 'public'),
      // Tarayıcı sürümü ve VS Code eklentisiyle aynı klasör (Windows'ta %APPDATA%\sakura-token-garden).
      dataDir: path.join(appDataDir(), 'data'),
    });
    server.on('snapshot', onSnapshot);
    server.on('shutdown-request', quit);
    const result = await server.start();
    baseUrl = result.url;

    createTray();
    if (!startHidden) createMain();
    if (prefs.widgetVisible || startHidden) setWidgetVisible(true);
    if (process.env.SAKURA_SELFTEST) selfTest(process.env.SAKURA_SELFTEST);
  });

  // Pencereler kapansa da tepside çalışmaya devam eder.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
  });
}
