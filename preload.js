const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('financeAPI', {
  getData: () => ipcRenderer.invoke('data:get'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  resetToSample: () => ipcRenderer.invoke('data:resetToSample'),
  showFilePath: () => ipcRenderer.invoke('data:showFilePath'),
  importFromFile: () => ipcRenderer.invoke('data:importFromFile'),
  exportToFile: () => ipcRenderer.invoke('data:exportToFile'),
  importBillsSpreadsheet: () => ipcRenderer.invoke('bills:importSpreadsheet'),
  backupDrive: () => ipcRenderer.invoke('drive:backup')
});
