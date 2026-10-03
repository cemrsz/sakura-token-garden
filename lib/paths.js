'use strict';
// Kullanıcı başına uygulama veri klasörü. Masaüstü uygulamasının (Electron userData),
// tarayıcı sürümünün ve VS Code eklentisinin ortak kullandığı yer:
//   Windows: %APPDATA%\sakura-token-garden
//   macOS:   ~/Library/Application Support/sakura-token-garden
//   Linux:   ~/.config/sakura-token-garden

const os = require('node:os');
const path = require('node:path');

const APP_DIR = 'sakura-token-garden';

function appDataDir() {
  if (process.env.SAKURA_DATA_DIR) return process.env.SAKURA_DATA_DIR;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_DIR);
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', APP_DIR);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), APP_DIR);
}

module.exports = { appDataDir, APP_DIR };
