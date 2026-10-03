'use strict';
// Sayfaya yalnızca üç masaüstü komutu açılır; Node erişimi verilmez.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sakuraDesktop', {
  toggleWidget: () => ipcRenderer.send('sakura:toggle-widget'),
  openMain: () => ipcRenderer.send('sakura:open-main'),
  quit: () => ipcRenderer.send('sakura:quit'),
});
