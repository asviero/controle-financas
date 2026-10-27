const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('financeAPI', {
  getData: () => ipcRenderer.invoke('data:get'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  resetToSample: () => ipcRenderer.invoke('data:resetToSample'),
  showFilePath: () => ipcRenderer.invoke('data:showFilePath'),
  importFromFile: () => ipcRenderer.invoke('data:importFromFile'),
  exportToFile: () => ipcRenderer.invoke('data:exportToFile'),
  exportBillsSpreadsheet: (billsData, defaultFilename, extraInfo) => ipcRenderer.invoke('bills:exportSpreadsheet', billsData, defaultFilename, extraInfo),
  backupDrive: () => ipcRenderer.invoke('drive:backup'),
  restoreBackup: () => ipcRenderer.invoke('data:restoreBackup')
});
