/* ===== Estado ===== */
let data = { people: [], categories: { income: [], expense: [] }, budgets: [], transactions: [], startingCashBalance: {}, bills: [], paymentMethods: [] };

let filters = {
  personIds: new Set(),
  categories: new Set(),
  from: null, // 'YYYY-MM'
  to: null
};

let billsFilter = {
  month: null
};

let charts = { trend: null, expense: null, budget: null };
let currentView = 'overview';

const fmtBRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const monthKey = (dateStr) => dateStr.slice(0, 7);
const todayMonth = () => new Date().toISOString().slice(0, 7);

function showDialog(message, { confirmMode = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;' +
      'align-items:center;justify-content:center;z-index:99999;';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:#1e2330;color:#fff;padding:20px;border-radius:10px;max-width:420px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,.5);">
        <p style="margin:0 0 16px;white-space:pre-line;line-height:1.4;"></p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          ${confirmMode ? '<button type="button" data-r="0">Cancelar</button>' : ''}
          <button type="button" data-r="1">${confirmMode ? 'Confirmar' : 'OK'}</button>
        </div>
      </div>`;
    overlay.querySelector('p').textContent = message;

    const close = (result) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(!confirmMode); }
    };

    overlay.onclick = (e) => {
      const r = e.target.dataset && e.target.dataset.r;
      if (r === undefined) return;
      close(r === '1');
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-r="1"]').focus();
  });
}

const askConfirm = (message) => showDialog(message, { confirmMode: true });
const askAlert = (message) => showDialog(message);

/* ===== Inicialização ===== */
async function init() {
  data = await window.financeAPI.getData();

  let dbNeedsUpdate = false;
  data.people.forEach(p => {
    if (p.tipo === 'PF' && !p.name.includes('(PF)')) { 
      p.name += ' (PF)';
      dbNeedsUpdate = true;
    }
    if (p.tipo === 'PJ' && !p.name.includes('(PJ)')) { 
      p.name += ' (PJ)';
      dbNeedsUpdate = true;
    }
  });
  if (dbNeedsUpdate) await persist();

  filters.personIds = new Set();
  if (data.people.length > 0) {
    filters.personIds.add(data.people[0].id);
  }
  filters.categories = new Set([...data.categories.income, ...data.categories.expense]);

  const months = data.transactions.map(t => monthKey(t.date));
  filters.from = months.length ? months.reduce((a, b) => a < b ? a : b) : todayMonth();
  filters.to = months.length ? months.reduce((a, b) => a > b ? a : b) : todayMonth();

  document.getElementById('dateFrom').value = filters.from;
  document.getElementById('dateTo').value = filters.to;

  if (!Array.isArray(data.bills)) data.bills = [];
  if (!Array.isArray(data.paymentMethods)) data.paymentMethods = ["Boleto", "Pix", "Cartão de Crédito", "Débito Automático", "Transferência", "Dinheiro", "Outro"];
  billsFilter.month = todayMonth();
  document.getElementById('billsMonth').value = billsFilter.month;

  renderPeopleFilter();
  renderCategoryFilter();
  populateModalSelects();
  populateBillModalSelects();
  bindEvents();
  
  await ensureFixedBillsForMonth(billsFilter.month);
  
  renderAll();
  renderBillsView();
}

async function persist() {
  await window.financeAPI.saveData(data);
}

/* ===== Filtros: sidebar ===== */
function renderPeopleFilter() {
  if (filters.personIds.size === 0 && data.people.length > 0) {
    filters.personIds.add(data.people[0].id);
  }

  const el = document.getElementById('peopleFilter');
  el.innerHTML = '';
  
  data.people.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (filters.personIds.has(p.id) ? ' active' : '');
    chip.style.color = filters.personIds.has(p.id) ? p.color : '';
    chip.innerHTML = `<span class="dot" style="background:${p.color}"></span>${p.name}`;
    
    chip.onclick = () => {
      filters.personIds.clear();
      filters.personIds.add(p.id);

      renderPeopleFilter();
      renderAll();
      renderBillsView();
    };
    
    el.appendChild(chip);
  });
}

function renderCategoryFilter() {
  const el = document.getElementById('categoryFilter');
  el.innerHTML = '';
  
  el.classList.remove('chip-list');

  const renderGroup = (title, categories, colorHex) => {
    if (!categories || categories.length === 0) return;

    // 1. Cria o título do grupo (Receitas ou Despesas)
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.color = colorHex;
    titleEl.style.fontSize = '0.75rem';
    titleEl.style.fontWeight = 'bold';
    titleEl.style.marginTop = '12px';
    titleEl.style.marginBottom = '8px';
    titleEl.style.textTransform = 'uppercase';
    titleEl.style.letterSpacing = '0.5px';
    el.appendChild(titleEl);

    // 2. Cria o container interno para os botões (chips)
    const chipContainer = document.createElement('div');
    chipContainer.className = 'chip-list';
    
    categories.forEach(cat => {
      const isActive = filters.categories.has(cat);
      const chip = document.createElement('div');
      chip.className = 'chip' + (isActive ? ' active' : '');
      chip.textContent = cat;
      
      // 3. Pinta o botão com a cor específica do grupo quando estiver selecionado
      if (isActive) {
        chip.style.backgroundColor = colorHex;
        chip.style.borderColor = colorHex;
        chip.style.color = '#fff';
      }

      chip.onclick = () => {
        isActive ? filters.categories.delete(cat) : filters.categories.add(cat);
        renderCategoryFilter();
        renderAll();
      };
      
      chipContainer.appendChild(chip);
    });

    el.appendChild(chipContainer);
  };

  // Chama a função auxiliar para desenhar os dois blocos com as cores corretas
  renderGroup('Receitas', data.categories.income, '#3fbf8f'); // Verde
  renderGroup('Despesas', data.categories.expense, '#e8664a'); // Laranja
}

function bindEvents() {
  document.getElementById('dateFrom').onchange = (e) => { filters.from = e.target.value; renderAll(); };
  document.getElementById('dateTo').onchange = (e) => { filters.to = e.target.value; renderAll(); };

  document.querySelectorAll('.quick-ranges button').forEach(btn => {
    btn.onclick = () => {
      const range = btn.dataset.range;
      const now = new Date();
      const thisMonth = now.toISOString().slice(0, 7);
      if (range === 'this-month') { filters.from = thisMonth; filters.to = thisMonth; }
      if (range === 'last-3') {
        const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        filters.from = d.toISOString().slice(0, 7); filters.to = thisMonth;
      }
      if (range === 'ytd') { filters.from = `${now.getFullYear()}-01`; filters.to = thisMonth; }
      if (range === 'all') {
        const months = data.transactions.map(t => monthKey(t.date));
        filters.from = months.length ? months.reduce((a, b) => a < b ? a : b) : thisMonth;
        filters.to = months.length ? months.reduce((a, b) => a > b ? a : b) : thisMonth;
      }
      document.getElementById('dateFrom').value = filters.from;
      document.getElementById('dateTo').value = filters.to;
      renderAll();
    };
  });

  document.getElementById('tableSearch').oninput = renderTable;

  // Backup no Drive e Resetar Banco de Dados
  document.getElementById('backupDriveBtn').onclick = async () => {
    const btn = document.getElementById('backupDriveBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Fazendo backup...';
    btn.disabled = true;

    try {
      const result = await window.financeAPI.backupDrive();
      if (result && result.success) {
        await askAlert('Backup concluído com sucesso!\nID do arquivo no Drive: ' + result.fileId);
      } else {
        await askAlert('Erro ao fazer backup: ' + (result?.message || 'Erro desconhecido.'));
      }
    } catch (error) {
      console.error(error);
      await askAlert('Ocorreu um erro ao conectar com o banco de dados.');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  };

  document.getElementById('resetBtn').onclick = async () => {
    if (!(await askConfirm('ATENÇÃO: Deseja apagar todos os dados do banco SQLite? Esta ação não pode ser desfeita.'))) return;
    data = await window.financeAPI.resetToSample();
    await init();
  };

  // Modal transação
  document.getElementById('addTransactionBtn').onclick = () => openTxModal();
  document.getElementById('txCancelBtn').onclick = closeTxModal;
  document.getElementById('txForm').onsubmit = onSaveTransaction;
  document.getElementById('txDeleteBtn').onclick = onDeleteTransaction;
  document.getElementById('txType').onchange = updateCategoryOptions;

  // Modal pessoas
  document.getElementById('managePeopleBtn').onclick = openPeopleModal;
  document.getElementById('peopleCloseBtn').onclick = () => togglePeopleModal(false);
  document.getElementById('addPersonForm').onsubmit = onAddPerson;

  const tipoSelect = document.getElementById('newPersonTipo');
  const inputCpf = document.getElementById('newPersonCpf');
  const inputCnpj = document.getElementById('newPersonCnpj');

  if (tipoSelect) {
    tipoSelect.onchange = (e) => {
      const v = e.target.value;
      if(inputCpf) inputCpf.style.display = (v === 'PF' || v === 'Ambos') ? 'block' : 'none';
      if(inputCnpj) inputCnpj.style.display = (v === 'PJ' || v === 'Ambos') ? 'block' : 'none';
    };
  }

  const maskInput = (input, type) => {
    if (!input) return;
    input.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '');
      if (type === 'cpf') {
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      } else {
        v = v.replace(/(\d{2})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d)/, '$1/$2');
        v = v.replace(/(\d{4})(\d{1,2})$/, '$1-$2');
      }
      e.target.value = v;
    });
  };

  maskInput(inputCpf, 'cpf');
  maskInput(inputCnpj, 'cnpj');

  // Modal categorias
  document.getElementById('manageCategoriesBtn').onclick = openCategoriesModal;
  document.getElementById('categoriesCloseBtn').onclick = () => toggleCategoriesModal(false);
  document.getElementById('addCategoryForm').onsubmit = onAddCategory;
  
  // Navegação entre views
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });

  // Contas a pagar: período
  document.getElementById('billsMonth').onchange = async (e) => { 
    billsFilter.month = e.target.value; 
    await ensureFixedBillsForMonth(billsFilter.month);
    renderBillsView(); 
  };
  document.getElementById('billsPrevMonth').onclick = () => shiftBillsMonth(-1);
  document.getElementById('billsNextMonth').onclick = () => shiftBillsMonth(1);
  document.getElementById('billsCurrentMonth').onclick = async () => {
    billsFilter.month = todayMonth();
    document.getElementById('billsMonth').value = billsFilter.month;
    await ensureFixedBillsForMonth(billsFilter.month);
    renderBillsView();
  };
  document.getElementById('billsAllMonths').onclick = () => { billsFilter.month = null; renderBillsView(); };

  // Contas a pagar: importar planilha
  document.getElementById('importBillsBtn').onclick = async () => {
    const result = await window.financeAPI.importBillsSpreadsheet();
    if (!result) return;
    data = result.data;
    renderBillsView();
    await askAlert(`${result.imported} de ${result.totalRows} linha(s) importada(s). Linhas sem "conta" ou "vencimento" válidos foram ignoradas.`);
  };

  // Contas a pagar: modal
  document.getElementById('addBillBtn').onclick = () => openBillModal();
  document.getElementById('billCancelBtn').onclick = closeBillModal;
  document.getElementById('billForm').onsubmit = onSaveBill;
  document.getElementById('billDeleteBtn').onclick = onDeleteBill;
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('overviewView').classList.toggle('hidden', view !== 'overview');
  document.getElementById('billsView').classList.toggle('hidden', view !== 'bills');
  document.querySelectorAll('.overview-only').forEach(el => el.classList.toggle('hidden', view !== 'overview'));
  document.querySelectorAll('.bills-only').forEach(el => el.classList.toggle('hidden', view !== 'bills'));
}

function shiftBillsMonth(delta) {
  const base = billsFilter.month || todayMonth();
  let [y, m] = base.split('-').map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
  billsFilter.month = `${y}-${String(m).padStart(2, '0')}`;
  document.getElementById('billsMonth').value = billsFilter.month;
  renderBillsView();
}

/* ===== Dados filtrados ===== */
function inRange(dateStr) {
  const m = monthKey(dateStr);
  return m >= filters.from && m <= filters.to;
}

function getFilteredTransactions() {
  return data.transactions.filter(t =>
    filters.personIds.has(t.personId) &&
    filters.categories.has(t.category) &&
    inRange(t.date)
  );
}

// Para saldo de caixa: respeita pessoa, ignora filtro de categoria, considera tudo até o fim do período
function getBalanceAt(endMonth) {
  let balance = data.people
    .filter(p => filters.personIds.has(p.id))
    .reduce((sum, p) => sum + (data.startingCashBalance[p.id] || 0), 0);

  data.transactions.forEach(t => {
    if (!filters.personIds.has(t.personId)) return;
    if (monthKey(t.date) > endMonth) return;
    balance += t.type === 'income' ? t.amount : -t.amount;
  });
  return balance;
}

/* ===== Render geral ===== */
function renderAll() {
  renderPeriodLabel();
  renderKPIs();
  renderTrendChart();
  renderExpenseChart();
  renderBudgetChart();
  renderTable();
}

function renderPeriodLabel() {
  document.getElementById('periodLabel').textContent = `${filters.from} — ${filters.to} · ${filters.personIds.size} pessoa(s)`;
}

function renderKPIs() {
  const tx = getFilteredTransactions();
  const income = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const profit = income - expense;
  const balance = getBalanceAt(filters.to);

  document.getElementById('kpiIncome').textContent = fmtBRL(income);
  document.getElementById('kpiExpense').textContent = fmtBRL(expense);
  document.getElementById('kpiProfit').textContent = fmtBRL(profit);
  document.getElementById('kpiProfit').style.color = profit >= 0 ? 'var(--income)' : 'var(--expense)';
  document.getElementById('kpiCashFlow').textContent = fmtBRL(profit);
  document.getElementById('kpiCashFlow').style.color = profit >= 0 ? 'var(--income)' : 'var(--expense)';
  document.getElementById('kpiBalance').textContent = fmtBRL(balance);
}

/* ===== Gráfico de tendência ===== */
function monthsBetween(from, to) {
  const months = [];
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

function renderTrendChart() {
  const months = monthsBetween(filters.from, filters.to);
  const tx = getFilteredTransactions();

  const incomeByMonth = months.map(m => tx.filter(t => t.type === 'income' && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0));
  const expenseByMonth = months.map(m => tx.filter(t => t.type === 'expense' && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0));
  const balanceByMonth = months.map(m => getBalanceAt(m));

  const ctx = document.getElementById('trendChart');
  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(ctx, {
    data: {
      labels: months,
      datasets: [
        { type: 'bar', label: 'Receita', data: incomeByMonth, backgroundColor: '#3fbf8f', borderRadius: 4, barPercentage: 0.55 },
        { type: 'bar', label: 'Despesas', data: expenseByMonth, backgroundColor: '#e8664a', borderRadius: 4, barPercentage: 0.55 },
        { type: 'line', label: 'Saldo acumulado', data: balanceByMonth, borderColor: '#5aa7e8', backgroundColor: '#5aa7e8', tension: 0.3, yAxisID: 'y1', pointRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8b96a5', usePointStyle: true, boxWidth: 8 } }
      },
      scales: {
        x: { ticks: { color: '#8b96a5' }, grid: { color: '#262f3b' } },
        y: { ticks: { color: '#8b96a5' }, grid: { color: '#262f3b' } },
        y1: { position: 'right', ticks: { color: '#5aa7e8' }, grid: { display: false } }
      }
    }
  });
}

/* ===== Gráfico de despesas por categoria ===== */
function renderExpenseChart() {
  const tx = getFilteredTransactions().filter(t => t.type === 'expense');
  const byCategory = {};
  tx.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; });

  const labels = Object.keys(byCategory);
  const values = Object.values(byCategory);
  const palette = ['#e8664a', '#e8a13b', '#e8d23b', '#8bd15a', '#3fbf8f', '#3bc2c4', '#5aa7e8', '#8a7fe0', '#d37fe0'];
  const colors = labels.map((_, i) => palette[i % palette.length]);

  const ctx = document.getElementById('expenseChart');
  if (charts.expense) charts.expense.destroy();
  charts.expense = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: { plugins: { legend: { display: false } }, cutout: '68%' }
  });

  const total = values.reduce((a, b) => a + b, 0) || 1;
  const legend = document.getElementById('expenseLegend');
  legend.innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <span class="lbl"><span class="sw" style="background:${colors[i]}"></span>${l}</span>
      <span class="val">${fmtBRL(byCategory[l])} · ${Math.round(byCategory[l] / total * 100)}%</span>
    </div>`).join('') || '<p class="hint">Sem despesas no período.</p>';
}

/* ===== Gráfico orçado vs realizado ===== */
function renderBudgetChart() {
  const months = monthsBetween(filters.from, filters.to);
  const relevantBudgets = data.budgets.filter(b => filters.personIds.has(b.personId) && months.includes(b.month) && filters.categories.has(b.category));

  const budgetedByCat = {};
  relevantBudgets.forEach(b => { budgetedByCat[b.category] = (budgetedByCat[b.category] || 0) + b.budgeted; });

  const tx = getFilteredTransactions().filter(t => t.type === 'expense');
  const actualByCat = {};
  tx.forEach(t => { actualByCat[t.category] = (actualByCat[t.category] || 0) + t.amount; });

  const categories = [...new Set([...Object.keys(budgetedByCat), ...Object.keys(actualByCat)])];

  const ctx = document.getElementById('budgetChart');
  if (charts.budget) charts.budget.destroy();
  charts.budget = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [
        { label: 'Orçado', data: categories.map(c => budgetedByCat[c] || 0), backgroundColor: '#5aa7e8', borderRadius: 4, barPercentage: 0.6 },
        { label: 'Realizado', data: categories.map(c => actualByCat[c] || 0), backgroundColor: categories.map(c => (actualByCat[c] || 0) > (budgetedByCat[c] || 0) ? '#e8664a' : '#3fbf8f'), borderRadius: 4, barPercentage: 0.6 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#8b96a5', usePointStyle: true, boxWidth: 8 } } },
      scales: {
        x: { ticks: { color: '#8b96a5' }, grid: { display: false } },
        y: { ticks: { color: '#8b96a5' }, grid: { color: '#262f3b' } }
      }
    }
  });
}

/* ===== Tabela de transações ===== */
function renderTable() {
  const search = document.getElementById('tableSearch').value.toLowerCase();
  const rows = getFilteredTransactions()
    .filter(t => t.description.toLowerCase().includes(search))
    .sort((a, b) => b.date.localeCompare(a.date));

  const body = document.getElementById('txTableBody');
  const peopleById = Object.fromEntries(data.people.map(p => [p.id, p]));

  body.innerHTML = rows.map(t => {
    const person = peopleById[t.personId];
    return `
    <tr data-id="${t.id}">
      <td>${formatDate(t.date)}</td>
      <td><span class="person-tag"><span class="dot" style="background:${person ? person.color : '#888'}"></span>${person ? person.name : '—'}</span></td>
      <td><span class="type-pill ${t.type}">${t.type === 'income' ? 'Receita' : 'Despesa'}</span></td>
      <td>${t.category}</td>
      <td>${t.description || '—'}</td>
      <td class="num ${t.type}">${t.type === 'income' ? '+' : '−'} ${fmtBRL(t.amount)}</td>
      <td></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="hint" style="padding:16px;">Nenhuma transação encontrada para os filtros atuais.</td></tr>`;

  body.querySelectorAll('tr[data-id]').forEach(row => {
    row.onclick = () => openTxModal(rows.find(t => t.id === row.dataset.id));
  });
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/* ===== Modal transação ===== */
function populateModalSelects() {
  const personSel = document.getElementById('txPerson');
  personSel.innerHTML = data.people.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  updateCategoryOptions();
}

function updateCategoryOptions() {
  const type = document.getElementById('txType').value;
  const catSel = document.getElementById('txCategory');
  const list = type === 'income' ? data.categories.income : data.categories.expense;
  catSel.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
}

function openTxModal(tx) {
  document.getElementById('txModalTitle').textContent = tx ? 'Editar transação' : 'Nova transação';
  document.getElementById('txId').value = tx ? tx.id : '';

  let activePerson = '';
  if (tx) {
    activePerson = tx.personId;
  } else if (filters.personIds.size > 0) {
    activePerson = Array.from(filters.personIds)[0];
  } else if (data.people.length > 0) {
    activePerson = data.people[0].id;
  }
  document.getElementById('txPerson').value = activePerson;

  document.getElementById('txType').value = tx ? tx.type : 'expense';
  updateCategoryOptions();
  document.getElementById('txCategory').value = tx ? tx.category : (document.getElementById('txCategory').options[0] || {}).value || '';
  document.getElementById('txDate').value = tx ? tx.date : new Date().toISOString().slice(0, 10);
  document.getElementById('txDescription').value = tx ? tx.description : '';
  document.getElementById('txAmount').value = tx ? tx.amount : '';
  document.getElementById('txDeleteBtn').classList.toggle('hidden', !tx);
  document.getElementById('txModalOverlay').classList.add('open');
}

function closeTxModal() {
  document.getElementById('txModalOverlay').classList.remove('open');
}

async function onSaveTransaction(e) {
  e.preventDefault();
  const id = document.getElementById('txId').value;
  const record = {
    id: id || 't' + Date.now(),
    personId: document.getElementById('txPerson').value,
    type: document.getElementById('txType').value,
    category: document.getElementById('txCategory').value,
    date: document.getElementById('txDate').value,
    description: document.getElementById('txDescription').value.trim(),
    amount: parseFloat(document.getElementById('txAmount').value)
  };
  if (id) {
    const idx = data.transactions.findIndex(t => t.id === id);
    data.transactions[idx] = record;
  } else {
    data.transactions.push(record);
  }
  await persist();
  closeTxModal();
  renderAll();
}

async function onDeleteTransaction() {
  const id = document.getElementById('txId').value;
  if (!id || !(await askConfirm('Excluir esta transação?'))) return;
  data.transactions = data.transactions.filter(t => t.id !== id);
  await persist();
  closeTxModal();
  renderAll();
}

/* ===== Modal pessoas ===== */
function openPeopleModal() {
  renderPeopleList();
  togglePeopleModal(true);
}

function togglePeopleModal(open) {
  document.getElementById('peopleModalOverlay').classList.toggle('open', open);
}

function renderPeopleList() {
  const el = document.getElementById('peopleList');
  el.innerHTML = data.people.map(p => {
    const doc = p.tipo === 'PJ' ? (p.cnpj || '—') : (p.cpf || '—');
    return `
    <div class="person-row" data-id="${p.id}">
      <span class="dot" style="background:${p.color}"></span>
      <span class="name">${p.name} <span class="hint" style="display:inline;">(${p.tipo || 'PF'} · ${doc})</span></span>
      <button data-remove="${p.id}">remover</button>
    </div>`;
  }).join('');

  el.querySelectorAll('button[data-remove]').forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const id = btn.dataset.remove;
      if (!(await askConfirm('Remover esta pessoa e todas as suas transações/orçamentos/contas?'))) return;

      data.people = data.people.filter(p => p.id !== id);
      data.transactions = data.transactions.filter(t => t.personId !== id);
      data.budgets = data.budgets.filter(b => b.personId !== id);
      data.bills.forEach(b => { if (b.personId === id) b.personId = null; });
      delete data.startingCashBalance[id];
      filters.personIds.delete(id);

      renderPeopleList();
      renderPeopleFilter();
      populateModalSelects();
      populateBillModalSelects();
      renderAll();
      renderBillsView();
      await persist();
    };
  });
}

async function onAddPerson(e) {
  e.preventDefault();
  const name = document.getElementById('newPersonName').value.trim();
  const color = document.getElementById('newPersonColor').value;
  const tipo = document.getElementById('newPersonTipo').value;
  const cpf = document.getElementById('newPersonCpf').value.trim();
  const cnpj = document.getElementById('newPersonCnpj').value.trim();
  
  if (!name) return;
  
  const baseId = 'p' + Date.now();

  // Função auxiliar para cadastrar a pessoa corretamente no banco de dados
  const createProfile = (idSuffix, nameSuffix, pTipo, pCpf, pCnpj) => {
    const id = baseId + idSuffix;
    data.people.push({
      id, name: name + nameSuffix, color, tipo: pTipo,
      cpf: pCpf, cnpj: pCnpj
    });
    data.startingCashBalance[id] = 0;
    
    // Se não houver ninguém selecionado no momento, seleciona este novo perfil
    if (filters.personIds.size === 0) filters.personIds.add(id);
  };

  // Se a pessoa for PF ou Ambos, cria o perfil PF
  if (tipo === 'PF' || tipo === 'Ambos') {
    createProfile(tipo === 'Ambos' ? '_PF' : '', ' (PF)', 'PF', cpf, '');
  }
  
  // Se a pessoa for PJ ou Ambos, cria o perfil PJ
  if (tipo === 'PJ' || tipo === 'Ambos') {
    createProfile(tipo === 'Ambos' ? '_PJ' : '', ' (PJ)', 'PJ', '', cnpj);
  }
  
  document.getElementById('newPersonName').value = '';
  document.getElementById('newPersonCpf').value = '';
  document.getElementById('newPersonCnpj').value = '';
  
  window.focus();
  document.getElementById('newPersonName').focus();
  
  renderPeopleList();
  renderPeopleFilter();
  populateModalSelects();
  populateBillModalSelects();
  
  setTimeout(async () => {
    renderAll();
    renderBillsView();
    await persist();
  }, 10);
}

/* ===== Modal categorias ===== */
function openCategoriesModal() {
  renderCategoriesList();
  toggleCategoriesModal(true);
}

function toggleCategoriesModal(open) {
  document.getElementById('categoriesModalOverlay').classList.toggle('open', open);
}

function renderCategoriesList() {
  const el = document.getElementById('categoriesList');
  let html = '';
  
  const buildRow = (cat, type, typeLabel) => `
    <div class="person-row">
      <span class="name">${cat} <span class="hint" style="display:inline;">(${typeLabel})</span></span>
      <button data-remove-cat="${cat}" data-cat-type="${type}">remover</button>
    </div>
  `;

  data.categories.income.forEach(c => html += buildRow(c, 'income', 'Receita'));
  data.categories.expense.forEach(c => html += buildRow(c, 'expense', 'Despesa'));

  el.innerHTML = html;

  el.querySelectorAll('button[data-remove-cat]').forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const cat = btn.dataset.removeCat;
      const type = btn.dataset.catType;
      if (!(await askConfirm(`Remover a categoria "${cat}"? (Transações antigas manterão este nome para histórico).`))) return;

      data.categories[type] = data.categories[type].filter(c => c !== cat);
      filters.categories.delete(cat);

      renderCategoriesList();
      renderCategoryFilter();
      populateModalSelects();
      renderAll();
      await persist();
    };
  });
}

async function onAddCategory(e) {
  e.preventDefault();
  const name = document.getElementById('newCategoryName').value.trim();
  const type = document.getElementById('newCategoryType').value;
  
  if (!name) return;

  if (data.categories.income.includes(name) || data.categories.expense.includes(name)) {
    await askAlert('Esta categoria já existe.');
    document.getElementById('newCategoryName').focus();
    return;
  }

  data.categories[type].push(name);
  filters.categories.add(name); 
  
  document.getElementById('newCategoryName').value = '';
  
  document.getElementById('newCategoryName').focus();

  renderCategoriesList();
  renderCategoryFilter();
  populateModalSelects();

  setTimeout(async () => {
    renderAll();
    await persist();
  }, 10);
}

/* ===== Contas a pagar ===== */
function computeBillStatus(bill) {
  if (bill.valorPago !== null && bill.valorPago !== undefined && bill.valorPago !== '') return 'pago';
  const venc = new Date(bill.vencimento + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((venc - today) / 86400000);
  if (diffDays < 0) return 'atrasado';
  if (diffDays <= 2) return 'vence_breve';
  return 'pendente';
}

const STATUS_LABELS = { pago: 'Pago', pendente: 'Pendente', vence_breve: 'Vence em breve', atrasado: 'Atrasado' };

function getFilteredBills() {
  return data.bills.filter(b => {
    const matchMonth = !billsFilter.month || monthKey(b.vencimento) === billsFilter.month;
    const matchPerson = filters.personIds.has(b.personId); // Garante que a conta pertence à pessoa selecionada
    return matchMonth && matchPerson;
  });
}

function populateBillModalSelects() {
  const formaSel = document.getElementById('billFormaPagamento');
  formaSel.innerHTML = data.paymentMethods.map(m => `<option value="${m}">${m}</option>`).join('');

  const personSel = document.getElementById('billPersonId');
  personSel.innerHTML = '<option value="">— sem pessoa vinculada —</option>' +
    data.people.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

function renderBillsView() {
  renderBillsPeriodLabel();
  renderBillsKPIs();
  renderBillsTable();
}

function renderBillsPeriodLabel() {
  document.getElementById('billsPeriodLabel').textContent = billsFilter.month
    ? billsFilter.month
    : 'Todos os períodos';
}

function renderBillsKPIs() {
  const bills = getFilteredBills();
  const total = bills.reduce((s, b) => s + (b.valorReferencia || 0), 0);
  const paid = bills.filter(b => computeBillStatus(b) === 'pago').reduce((s, b) => s + (b.valorPago || 0), 0);
  const pending = bills.filter(b => computeBillStatus(b) !== 'pago').reduce((s, b) => s + (b.valorReferencia || 0), 0);
  const overdueCount = bills.filter(b => computeBillStatus(b) === 'atrasado').length;

  document.getElementById('billsKpiTotal').textContent = fmtBRL(total);
  document.getElementById('billsKpiPaid').textContent = fmtBRL(paid);
  document.getElementById('billsKpiPending').textContent = fmtBRL(pending);
  document.getElementById('billsKpiOverdue').textContent = overdueCount;
}

function renderBillsTable() {
  const search = (document.getElementById('billsSearch').value || '').toLowerCase();
  const peopleById = Object.fromEntries(data.people.map(p => [p.id, p]));

  const rows = getFilteredBills()
    .filter(b => b.conta.toLowerCase().includes(search))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const body = document.getElementById('billsTableBody');
  body.innerHTML = rows.map(b => {
    const status = computeBillStatus(b);
    const person = peopleById[b.personId];
    const comprovanteCell = b.comprovante
      ? `<a href="${b.comprovante}" class="comprovante-link" target="_blank" onclick="event.stopPropagation()">Ver</a>`
      : '—';
    return `
    <tr data-id="${b.id}" class="row-${status}">
      <td>${b.conta}</td>
      <td>${formatDate(b.vencimento)}</td>
      <td>${monthKey(b.vencimento)}</td>
      <td class="num">${fmtBRL(b.valorReferencia || 0)}</td>
      <td>${b.formaPagamento || '—'}</td>
      <td>${b.banco || '—'}</td>
      <td>${person ? person.name : '—'}</td>
      <td class="num">${b.valorPago ? fmtBRL(b.valorPago) : '—'}</td>
      <td><span class="status-pill ${status}">${STATUS_LABELS[status]}</span></td>
      <td>${comprovanteCell}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="10" class="hint" style="padding:16px;">Nenhuma conta encontrada para o período selecionado.</td></tr>`;

  body.querySelectorAll('tr[data-id]').forEach(row => {
    row.onclick = () => openBillModal(rows.find(b => b.id === row.dataset.id));
  });
}

function openBillModal(bill) {
  document.getElementById('billModalTitle').textContent = bill ? 'Editar conta' : 'Nova conta';
  document.getElementById('billId').value = bill ? bill.id : '';
  document.getElementById('billConta').value = bill ? bill.conta : '';
  document.getElementById('billVencimento').value = bill ? bill.vencimento : '';
  document.getElementById('billValorReferencia').value = bill ? bill.valorReferencia : '';
  document.getElementById('billFormaPagamento').value = bill ? bill.formaPagamento : (data.paymentMethods[0] || '');
  document.getElementById('billBanco').value = bill ? bill.banco : '';
  document.getElementById('billIsFixed').checked = bill ? !!bill.isFixed : false;
  
  let activePerson = '';
  if (bill) {
    activePerson = bill.personId || '';
  } else if (filters.personIds.size > 0) {
    activePerson = Array.from(filters.personIds)[0];
  }
  document.getElementById('billPersonId').value = activePerson;

  document.getElementById('billValorPago').value = bill && bill.valorPago !== null && bill.valorPago !== undefined ? bill.valorPago : '';
  document.getElementById('billComprovante').value = bill ? bill.comprovante : '';
  document.getElementById('billDeleteBtn').classList.toggle('hidden', !bill);
  document.getElementById('billModalOverlay').classList.add('open');
}

function closeBillModal() {
  document.getElementById('billModalOverlay').classList.remove('open');
}

async function onSaveBill(e) {
  e.preventDefault();
  const id = document.getElementById('billId').value;
  const valorPagoRaw = document.getElementById('billValorPago').value;
  const isFixed = document.getElementById('billIsFixed').checked;
  
  const recordId = id || 'b' + Date.now();
  // Cria um ID de grupo para que o sistema saiba que estas contas mensais são a mesma
  let fixedGroupId = id ? (data.bills.find(b => b.id === id)?.fixedGroupId || recordId) : recordId;
  
  const record = {
    id: recordId,
    conta: document.getElementById('billConta').value.trim(),
    vencimento: document.getElementById('billVencimento').value,
    valorReferencia: parseFloat(document.getElementById('billValorReferencia').value) || 0,
    formaPagamento: document.getElementById('billFormaPagamento').value,
    banco: document.getElementById('billBanco').value.trim(),
    personId: document.getElementById('billPersonId').value || null,
    valorPago: valorPagoRaw === '' ? null : parseFloat(valorPagoRaw),
    comprovante: document.getElementById('billComprovante').value.trim(),
    isFixed: isFixed,
    fixedGroupId: fixedGroupId
  };
  
  if (id) {
    // Se você editar e DESMARCAR a opção de conta fixa, ele cancela a repetição automática
    if (!isFixed) {
      data.bills.forEach(b => { if (b.fixedGroupId === fixedGroupId) b.isFixed = false; });
    }
    const idx = data.bills.findIndex(b => b.id === id);
    data.bills[idx] = record;
  } else {
    data.bills.push(record);
  }
  
  await persist();
  closeBillModal();
  
  await ensureFixedBillsForMonth(monthKey(record.vencimento));
  renderBillsView();
}

async function onDeleteBill() {
  const id = document.getElementById('billId').value;
  if (!id || !(await askConfirm('Excluir esta conta?'))) return;
  data.bills = data.bills.filter(b => b.id !== id);
  await persist();
  closeBillModal();
  renderBillsView();
}

/* ===== CLONADOR DE CONTAS FIXAS ===== */
async function ensureFixedBillsForMonth(monthStr) {
  if (!monthStr) return;
  let added = false;

  // Encontra a versão mais recente de cada conta fixa para usar como "molde"
  const fixedTemplates = new Map();
  data.bills.forEach(b => {
    if (b.isFixed) {
        if (!fixedTemplates.has(b.fixedGroupId) || b.vencimento > fixedTemplates.get(b.fixedGroupId).vencimento) {
          fixedTemplates.set(b.fixedGroupId, b);
        }
    }
  });

  // Para cada conta fixa, verifica se já existe uma cópia no mês selecionado
  fixedTemplates.forEach(template => {
    const existsInMonth = data.bills.some(b => b.fixedGroupId === template.fixedGroupId && monthKey(b.vencimento) === monthStr);

    if (!existsInMonth) {
        const day = template.vencimento.split('-')[2];
        let targetDate = `${monthStr}-${day}`;
        
        // Corrige dias que não existem (ex: 31 de Fevereiro -> 28 de Fevereiro)
        const d = new Date(targetDate + 'T00:00:00');
        if (isNaN(d.getTime()) || d.getDate() !== parseInt(day)) {
          const [y, m] = monthStr.split('-').map(Number);
          const lastDay = new Date(y, m, 0).getDate();
          targetDate = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
        }

        data.bills.push({
          id: 'b' + Date.now() + Math.random().toString(36).substring(2, 5),
          conta: template.conta,
          vencimento: targetDate,
          valorReferencia: template.valorReferencia,
          formaPagamento: template.formaPagamento,
          banco: template.banco,
          personId: template.personId,
          valorPago: null,
          comprovante: '',
          isFixed: true,
          fixedGroupId: template.fixedGroupId
        });
        added = true;
    }
  });

  if (added) await persist();
}

// Substituir a navegação de meses para acionar o Clonador
async function shiftBillsMonth(delta) {
  const base = billsFilter.month || todayMonth();
  let [y, m] = base.split('-').map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
  billsFilter.month = `${y}-${String(m).padStart(2, '0')}`;
  document.getElementById('billsMonth').value = billsFilter.month;
  
  await ensureFixedBillsForMonth(billsFilter.month);
  renderBillsView();
}

init();