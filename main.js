const sqlite3 = require('sqlite3').verbose();
const { google } = require('googleapis');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const http = require('http');
const url = require('url');

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

// Restaurar Backup a partir de um ficheiro local (.db)
ipcMain.handle('data:restoreBackup', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Restaurar Backup do Banco de Dados',
    filters: [{ name: 'Banco de Dados', extensions: ['db', 'sqlite', 'sqlite3'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const selectedFile = result.filePaths[0];

  return new Promise((resolve) => {
    // Abre o banco de dados selecionado de forma provisória e apenas para leitura
    const tempDb = new sqlite3.Database(selectedFile, sqlite3.OPEN_READONLY, (err) => {
      if (err) return resolve({ success: false, message: 'Falha ao abrir o arquivo selecionado.' });
    });

    // Tenta procurar a tabela app_data (se não existir, não é um backup do nosso sistema)
    tempDb.get("SELECT json_state FROM app_data WHERE id = 1", async (err, row) => {
      tempDb.close(); // Fecha a conexão com o ficheiro importado imediatamente
      
      if (err || !row || !row.json_state) {
        return resolve({ success: false, message: 'O arquivo não é um backup válido deste aplicativo.' });
      }
      
      try {
        const parsedData = JSON.parse(row.json_state);
        await saveDbData(parsedData); // Grava os dados lidos no banco de dados oficial
        resolve({ success: true, data: parsedData });
      } catch (e) {
        resolve({ success: false, message: 'Dados corrompidos no arquivo de backup.' });
      }
    });
  });
});

// Exportar Contas a Pagar (Planilha com Design e Totais)
ipcMain.handle('bills:exportSpreadsheet', async (event, billsData, defaultFilename, extraInfo) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar contas a pagar',
    defaultPath: defaultFilename || 'Contas_a_Pagar.xlsx',
    filters: [{ name: 'Planilha Excel', extensions: ['xlsx'] }]
  });
  
  if (result.canceled || !result.filePath) return { success: false };

  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Contas');

    if (billsData && billsData.length > 0) {
      // 1. Linha do Período no topo do Excel
      worksheet.addRow(['Período Selecionado:', extraInfo.period]);
      worksheet.addRow([]); // Linha 2 em branco para dar um respiro
      
      // 2. Cabeçalhos da tabela (agora na linha 3)
      const headers = Object.keys(billsData[0]);
      worksheet.addRow(headers);

      // 3. Inserir as linhas de Dados
      billsData.forEach(item => {
        worksheet.addRow(Object.values(item));
      });

      // 4. Criar e inserir a linha de Total no final da tabela
      const totalRow = [];
      headers.forEach((h, i) => {
        if (h === 'Valor de Referência (R$)') {
          totalRow[i] = 'TOTAL PAGO:'; // Texto alinhado antes do valor
        } else if (h === 'Valor Pago (R$)') {
          totalRow[i] = extraInfo.totalPaid; // O valor total em si
        } else {
          totalRow[i] = ''; // Deixa o resto das colunas em branco na última linha
        }
      });
      const addedTotalRow = worksheet.addRow(totalRow);

      // === ESTILOS VISUAIS ===
      
      // Estilo do Período (Topo)
      worksheet.getCell('A1').font = { bold: true };
      worksheet.getCell('B1').alignment = { horizontal: 'left' };

      // Estilo do Cabeçalho da Tabela
      worksheet.getRow(3).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF262F3B' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      // Estilo dos Dados (Centralizar e formatar moeda)
      const lastRow = worksheet.rowCount;
      for (let r = 4; r <= lastRow; r++) {
        worksheet.getRow(r).eachCell((cell) => {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          
          // Se for um número, formata nativamente como Moeda (R$) no Excel
          if (typeof cell.value === 'number') {
            cell.numFmt = '"R$"#,##0.00';
          }
        });
      }

      // Estilo da Linha de Total (Fundo cinza claro e Negrito)
      addedTotalRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } }; 
      });

      // Auto-ajuste de largura das colunas
      for (let c = 1; c <= headers.length; c++) {
        let maxLength = 0;
        worksheet.getColumn(c).eachCell({ includeEmpty: true }, (cell, rowNumber) => {
          if (rowNumber >= 3) { // Mede apenas da tabela para baixo
            const val = cell.value ? cell.value.toString() : '';
            if (val.length > maxLength) maxLength = val.length;
          }
        });
        worksheet.getColumn(c).width = maxLength < 12 ? 14 : maxLength + 4;
      }
    }

    await workbook.xlsx.writeFile(result.filePath);
    return { success: true, filePath: result.filePath };
    
  } catch (error) {
    console.error('Erro ao exportar planilha:', error);
    return { success: false, message: error.message };
  }
});

// ==========================================
// --- BACKUP NO GOOGLE DRIVE ---
// ==========================================

const CREDENTIALS_PATH = path.join(__dirname, 'oauth_credentials.json');
const TOKEN_PATH = path.join(app.getPath('userData'), 'google_token.json');

async function executeBackup(authClient) {
  const drive = google.drive({ version: 'v3', auth: authClient });
  
  const fileMetadata = {
    name: `Backup_Financas_${new Date().toISOString().slice(0, 10)}.db`,
    parents: ['1MNV70v0c5T88VMlZaRIxXPoN0IV3_qLk']
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
}

ipcMain.handle('drive:backup', async () => {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return { success: false, message: "Arquivo 'oauth_credentials.json' não encontrado na pasta raiz." };
    }

    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    
    const oauth2Client = new google.auth.OAuth2(
      key.client_id,
      key.client_secret,
      'http://localhost:3000/oauth2callback'
    );

    // Função que pede o login com proteção anti-congelamento
    const askForNewLogin = () => {
      return new Promise((resolve) => {
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: ['https://www.googleapis.com/auth/drive.file'],
        });

        const server = http.createServer(async (req, res) => {
          if (req.url.startsWith('/oauth2callback')) {
            const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
            const code = qs.get('code');
            
            res.end('Autenticacao concluida com sucesso! Pode fechar esta aba do navegador e voltar ao programa.');
            
            server.close();
            for (const socket of sockets) socket.destroy();
            clearTimeout(timeoutId); // Cancela o alarme de timeout

            try {
              const { tokens } = await oauth2Client.getToken(code);
              oauth2Client.setCredentials(tokens);
              fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
              
              const result = await executeBackup(oauth2Client);
              resolve(result);
            } catch (err) {
              resolve({ success: false, message: 'Erro ao obter token: ' + err.message });
            }
          }
        });

        const sockets = new Set();
        server.on('connection', (socket) => {
          sockets.add(socket);
          socket.once('close', () => sockets.delete(socket));
        });

        // PROTEÇÃO 1: Se a porta 3000 estiver ocupada, não deixa a tela travada
        server.on('error', (e) => {
          clearTimeout(timeoutId);
          resolve({ success: false, message: 'A porta 3000 está ocupada por outro programa. Feche processos perdidos ou reinicie o PC. Detalhe: ' + e.message });
        });

        // PROTEÇÃO 2: Limite de 2 minutos. Se o usuário não logar no navegador, ele cancela.
        const timeoutId = setTimeout(() => {
          server.close();
          for (const socket of sockets) socket.destroy();
          resolve({ success: false, message: 'O tempo limite de login esgotou. A janela do navegador abriu em segundo plano?' });
        }, 120000);

        // Inicia servidor e tenta abrir o navegador
        server.listen(3000, () => {
          shell.openExternal(authUrl);
        });
      });
    };

    // Tenta usar o token guardado
    if (fs.existsSync(TOKEN_PATH)) {
      try {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        oauth2Client.setCredentials(token);
        return await executeBackup(oauth2Client);
      } catch (err) {
        console.log('Token antigo inválido. Apagando e solicitando novo login...');
        fs.unlinkSync(TOKEN_PATH); 
        return await askForNewLogin();
      }
    } 
    
    // Sem token, pede login na hora
    return await askForNewLogin();

  } catch (error) {
    console.error("Erro fatal no fluxo do Drive:", error);
    return { success: false, message: error.message };
  }
});