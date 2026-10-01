const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// Remove acentos e padroniza para comparar nomes de coluna com flexibilidade
function normalizeHeader(h) {
  return String(h || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Aceita número, "1500", "1.500,00" ou "R$ 1.500,00"
function parseCurrency(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^0-9,.-]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Aceita Date (quando cellDates:true), número serial do Excel ou texto dd/mm/aaaa | aaaa-mm-dd
function parseDateCell(raw) {
  if (raw instanceof Date && !isNaN(raw)) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(raw || '').trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return null;
}

let mainWindow;

function getDataFilePath() {
  return path.join(app.getPath('userData'), 'dados-financas.json');
}

function ensureDataFile() {
  const dataPath = getDataFilePath();
  if (!fs.existsSync(dataPath)) {
    const samplePath = path.join(__dirname, 'data', 'sample-data.json');
    const sampleData = fs.readFileSync(samplePath, 'utf-8');
    fs.writeFileSync(dataPath, sampleData, 'utf-8');
  }
  return dataPath;
}

function readData() {
  const dataPath = ensureDataFile();
  const raw = fs.readFileSync(dataPath, 'utf-8');
  return JSON.parse(raw);
}

function writeData(data) {
  const dataPath = ensureDataFile();
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#11151b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ensureDataFile();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: dados ----
ipcMain.handle('data:get', () => readData());

ipcMain.handle('data:save', (_event, data) => writeData(data));

ipcMain.handle('data:resetToSample', () => {
  const samplePath = path.join(__dirname, 'data', 'sample-data.json');
  const sampleData = fs.readFileSync(samplePath, 'utf-8');
  fs.writeFileSync(getDataFilePath(), sampleData, 'utf-8');
  return JSON.parse(sampleData);
});

ipcMain.handle('data:showFilePath', () => getDataFilePath());

// Importar um arquivo JSON externo (para substituir pelos dados reais do usuário)
ipcMain.handle('data:importFromFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar dados financeiros (JSON)',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
  const parsed = JSON.parse(raw);
  writeData(parsed);
  return parsed;
});

// Importar uma planilha (.xlsx/.xls/.csv) de contas a pagar: conta, vencimento,
// valor de referência, forma de pagamento, banco. O período é calculado a partir
// do vencimento, não é uma coluna importada.
ipcMain.handle('bills:importSpreadsheet', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar contas a pagar (planilha)',
    filters: [{ name: 'Planilhas', extensions: ['xlsx', 'xls', 'csv'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const workbook = XLSX.readFile(result.filePaths[0], { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const COLUMN_ALIASES = {
    conta: ['conta', 'nomedaconta', 'descricao'],
    vencimento: ['vencimento', 'datadevencimento', 'data'],
    valorReferencia: ['valorreferencia', 'valorderferencia', 'valor', 'valorprevisto'],
    formaPagamento: ['formadepagamento', 'formapagamento', 'pagamento'],
    banco: ['banco', 'bancovinculado']
  };

  function findValue(rowObj, aliases) {
    const keys = Object.keys(rowObj);
    for (const key of keys) {
      if (aliases.includes(normalizeHeader(key))) return rowObj[key];
    }
    return '';
  }

  const data = readData();
  if (!Array.isArray(data.bills)) data.bills = [];

  let imported = 0;
  rows.forEach((row, idx) => {
    const conta = String(findValue(row, COLUMN_ALIASES.conta)).trim();
    const vencRaw = findValue(row, COLUMN_ALIASES.vencimento);
    const vencimento = parseDateCell(vencRaw);
    if (!conta || !vencimento) return; // linha inválida/sem os campos mínimos, pula

    data.bills.push({
      id: 'b' + Date.now() + '_' + idx,
      conta,
      vencimento,
      valorReferencia: parseCurrency(findValue(row, COLUMN_ALIASES.valorReferencia)) || 0,
      formaPagamento: String(findValue(row, COLUMN_ALIASES.formaPagamento)).trim(),
      banco: String(findValue(row, COLUMN_ALIASES.banco)).trim(),
      personId: null,
      valorPago: null,
      comprovante: ''
    });
    imported++;
  });

  writeData(data);
  return { data, imported, totalRows: rows.length };
});

// Exportar os dados atuais para um arquivo JSON escolhido pelo usuário
ipcMain.handle('data:exportToFile', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar dados financeiros',
    defaultPath: 'meus-dados-financas.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return null;
  const data = readData();
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
  return result.filePath;
});
