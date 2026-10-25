// The only bridge between the window and the main process.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);
const on = (channel) => (handler) => {
  const wrapped = (_e, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('fire', {
  appInfo: invoke('app:info'),
  adbStatus: invoke('adb:status'),
  adbDownload: invoke('adb:download'),
  find: invoke('stick:find'),
  open: invoke('stick:open'),
  current: invoke('stick:current'),
  preview: invoke('stick:preview'),
  cleanup: invoke('stick:cleanup'),
  undo: invoke('stick:undo'),
  reapply: invoke('stick:reapply'),
  removedList: invoke('stick:removedList'),
  yourApps: invoke('stick:yourApps'),
  uninstall: invoke('stick:uninstall'),
  reboot: invoke('stick:reboot'),
  androidVersion: invoke('stick:androidVersion'),
  hasProjectivy: invoke('stick:hasProjectivy'),
  openProjectivy: invoke('stick:openProjectivy'),
  enableProjectivy: invoke('stick:enableProjectivy'),
  enableHomeOnFire: invoke('stick:enableHomeOnFire'),
  pickAndInstall: invoke('stick:pickAndInstall'),
  openProjectivyPage: invoke('open:projectivyPage'),
  openUrl: invoke('open:url'),
  openLogs: invoke('open:logs'),
  onLog: on('log'),
  onAdbProgress: on('adb:progress'),
  onFindProgress: on('find:progress'),
  onPrompt: on('stick:prompt'),
});
