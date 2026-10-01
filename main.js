const sqlite3 = require('sqlite3').verbose();
const { google } = require('googleapis');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// --- CONFIGURAÇÃO DO BANCO DE DADOS (SQLite) ---
const dbPath = path.join(app.getPath('userData'), 'financas.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Cria uma tabela para armazenar o estado completo do app como um JSON
  db.run("CREATE TABLE IF NOT EXISTS app_data (id INTEGER PRIMARY KEY, json_state TEXT)");
});

// --- FUNÇÕES UTILITÁRIAS DE BANCO DE DADOS ---
function getDbData() {
  return new Promise((resolve, reject) => {
    db.get("SELECT json_state FROM app_data WHERE id = 1", (err, row) => {
      if (err) return reject(err);
      
      if (row && row.json_state) {
        resolve(JSON.parse(row.json_state));
      } else {
        // Estrutura padrão se o banco for novo/vazio (evita crash no app.js)
        resolve({
          people: [], 
          categories: { income: [], expense: [] }, 
          budgets: [], 
          transactions: [], 
          startingCashBalance: {}, 
          bills: [], 
          paymentMethods: ["Boleto", "Pix", "Cartão de Crédito", "Débito Automático", "Transferência", "Dinheiro", "Outro"]
        });
      }
    });
  });
}

function saveDbData(dataObj) {
  return new Promise((resolve, reject) => {
    const jsonStr = JSON.stringify(dataObj);
    // REPLACE garante que ele sempre atualize a linha com id 1
    db.run("REPLACE INTO app_data (id, json_state) VALUES (1, ?)", [jsonStr], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

// --- FUNÇÕES UTILITÁRIAS DE PLANILHA ---
function normalizeHeader(h) {
  return String(h || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCurrency(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^0-9,.-]/g, '');
  if (s.includes(',') && s.includes('.')) { s = s.replace(/\./g, '').replace(',', '.'); } 
  else if (s.includes(',')) { s = s.replace(',', '.'); }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

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

// --- CONFIGURAÇÃO DA JANELA ---
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#11151b',
    icon: path.join(__dirname, 'icon.png'),
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==========================================
// --- IPC: COMUNICAÇÃO COM O FRONTEND ---
// ==========================================

ipcMain.handle('data:get', async () => {
  return await getDbData();
});

ipcMain.handle('data:save', async (_event, data) => {
  return await saveDbData(data);
});

ipcMain.handle('data:resetToSample', async () => {
  const samplePath = path.join(__dirname, 'data', 'sample-data.json');
  let sampleData;
  try {
    sampleData = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
  } catch (e) {
    sampleData = { people: [], categories: { income: [], expense: [] }, budgets: [], transactions: [], startingCashBalance: {}, bills: [], paymentMethods: [] };
  }
  await saveDbData(sampleData);
  return sampleData;
});

// Remove o aviso de arquivo local
ipcMain.handle('data:showFilePath', () => 'Banco de Dados SQLite Integrado');

// Importar Contas a Pagar (Planilha)
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

  // Puxa os dados atuais do banco
  const data = await getDbData();
  if (!Array.isArray(data.bills)) data.bills = [];

  let imported = 0;
  rows.forEach((row, idx) => {
    const conta = String(findValue(row, COLUMN_ALIASES.conta)).trim();
    const vencRaw = findValue(row, COLUMN_ALIASES.vencimento);
    const vencimento = parseDateCell(vencRaw);
    
    if (!conta || !vencimento) return;

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

  await saveDbData(data);
  return { data, imported, totalRows: rows.length };
});

// ==========================================
// --- BACKUP NO GOOGLE DRIVE ---
// ==========================================

ipcMain.handle('drive:backup', async () => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, 'credentials.json'), 
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    
    const drive = google.drive({ version: 'v3', auth });
    
    const fileMetadata = {
      name: `Backup_Financas_${new Date().toISOString().slice(0, 10)}.db`,
    };
    
    const media = {
      mimeType: 'application/x-sqlite3',
      body: fs.createReadStream(dbPath)
    };
    
    const res = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });
    
    return { success: true, message: 'Backup concluído!', fileId: res.data.id };
  } catch (error) {
    console.error("Erro no backup Drive:", error);
    return { success: false, message: error.message };
  }
});