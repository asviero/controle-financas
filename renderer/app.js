/* ===== Estado ===== */
let data = { people: [], categories: { income: [], expense: [] }, budgets: [], transactions: [], startingCashBalance: {}, bills: [], paymentMethods: [] };

let filters = {
  personIds: new Set(),
  categories: new Set(),
  from: null, // 'YYYY-MM'
  to: null
};

let billsFilter = {
  month: null // 'YYYY-MM' ou null = todos os períodos
};

let charts = { trend: null, expense: null, budget: null };
let currentView = 'overview';

const fmtBRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const monthKey = (dateStr) => dateStr.slice(0, 7);
const todayMonth = () => new Date().toISOString().slice(0, 7);

/* ===== Inicialização ===== */
async function init() {
  data = await window.financeAPI.getData();

  filters.personIds = new Set(data.people.map(p => p.id));
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
  renderAll();
  renderBillsView();
}

async function persist() {
  await window.financeAPI.saveData(data);
}

/* ===== Filtros: sidebar ===== */
function renderPeopleFilter() {
  const el = document.getElementById('peopleFilter');
  el.innerHTML = '';
  data.people.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (filters.personIds.has(p.id) ? ' active' : '');
    chip.style.color = filters.personIds.has(p.id) ? p.color : '';
    chip.innerHTML = `<span class="dot" style="background:${p.color}"></span>${p.name}`;
    chip.onclick = () => {
      filters.personIds.has(p.id) ? filters.personIds.delete(p.id) : filters.personIds.add(p.id);
      renderPeopleFilter();
      renderAll();
    };
    el.appendChild(chip);
  });
}

function renderCategoryFilter() {
  const el = document.getElementById('categoryFilter');
  el.innerHTML = '';
  const all = [...data.categories.income, ...data.categories.expense];
  all.forEach(cat => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (filters.categories.has(cat) ? ' active' : '');
    chip.textContent = cat;
    chip.onclick = () => {
      filters.categories.has(cat) ? filters.categories.delete(cat) : filters.categories.add(cat);
      renderCategoryFilter();
      renderAll();
    };
    el.appendChild(chip);
  });
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
        alert('Backup concluído com sucesso!\nID do arquivo no Drive: ' + result.fileId);
      } else {
        alert('Erro ao fazer backup: ' + (result?.message || 'Erro desconhecido.'));
      }
    } catch (error) {
      console.error(error);
      alert('Ocorreu um erro ao conectar com o banco de dados.');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  };

  document.getElementById('resetBtn').onclick = async () => {
    if (!confirm('ATENÇÃO: Deseja apagar todos os dados do banco SQLite? Esta ação não pode ser desfeita.')) return;
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
  document.getElementById('newPersonTipo').onchange = (e) => {
    document.getElementById('newPersonDoc').placeholder = e.target.value === 'PJ' ? 'CNPJ' : 'CPF';
  };

  // Modal categorias
  document.getElementById('manageCategoriesBtn').onclick = openCategoriesModal;
  document.getElementById('categoriesCloseBtn').onclick = () => toggleCategoriesModal(false);
  document.getElementById('addCategoryForm').onsubmit = onAddCategory;
  // -----------------------------
  // Navegação entre views
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });

  // Contas a pagar: período
  document.getElementById('billsMonth').onchange = (e) => { billsFilter.month = e.target.value; renderBillsView(); };
  document.getElementById('billsPrevMonth').onclick = () => shiftBillsMonth(-1);
  document.getElementById('billsNextMonth').onclick = () => shiftBillsMonth(1);
  document.getElementById('billsCurrentMonth').onclick = () => {
    billsFilter.month = todayMonth();
    document.getElementById('billsMonth').value = billsFilter.month;
    renderBillsView();
  };
  document.getElementById('billsAllMonths').onclick = () => { billsFilter.month = null; renderBillsView(); };
  document.getElementById('billsSearch').oninput = renderBillsTable;

  // Contas a pagar: importar planilha
  document.getElementById('importBillsBtn').onclick = async () => {
    const result = await window.financeAPI.importBillsSpreadsheet();
    if (!result) return;
    data = result.data;
    renderBillsView();
    alert(`${result.imported} de ${result.totalRows} linha(s) importada(s). Linhas sem "conta" ou "vencimento" válidos foram ignoradas.`);
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
  document.getElementById('txPerson').value = tx ? tx.personId : (data.people[0] ? data.people[0].id : '');
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
  if (!id || !confirm('Excluir esta transação?')) return;
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
    btn.onclick = async () => {
      const id = btn.dataset.remove;
      if (!confirm('Remover esta pessoa e todas as suas transações/orçamentos/contas?')) return;
      data.people = data.people.filter(p => p.id !== id);
      data.transactions = data.transactions.filter(t => t.personId !== id);
      data.budgets = data.budgets.filter(b => b.personId !== id);
      data.bills.forEach(b => { if (b.personId === id) b.personId = null; });
      delete data.startingCashBalance[id];
      await persist();
      renderPeopleList();
      renderPeopleFilter();
      populateModalSelects();
      populateBillModalSelects();
      renderAll();
      renderBillsView();
    };
  });
}

async function onAddPerson(e) {
  e.preventDefault();
  const name = document.getElementById('newPersonName').value.trim();
  const color = document.getElementById('newPersonColor').value;
  const tipo = document.getElementById('newPersonTipo').value;
  const doc = document.getElementById('newPersonDoc').value.trim();
  if (!name) return;
  const id = 'p' + Date.now();
  data.people.push({
    id, name, color, tipo,
    cpf: tipo === 'PF' ? doc : '',
    cnpj: tipo === 'PJ' ? doc : ''
  });
  data.startingCashBalance[id] = 0;
  filters.personIds.add(id);
  document.getElementById('newPersonName').value = '';
  document.getElementById('newPersonDoc').value = '';
  await persist();
  renderPeopleList();
  renderPeopleFilter();
  populateModalSelects();
  populateBillModalSelects();
  renderAll();
  renderBillsView();
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

  // Monta a lista com as receitas primeiro, depois as despesas
  data.categories.income.forEach(c => html += buildRow(c, 'income', 'Receita'));
  data.categories.expense.forEach(c => html += buildRow(c, 'expense', 'Despesa'));

  el.innerHTML = html;

  // Lógica de exclusão
  el.querySelectorAll('button[data-remove-cat]').forEach(btn => {
    btn.onclick = async () => {
      const cat = btn.dataset.removeCat;
      const type = btn.dataset.catType;
      
      if (!confirm(`Remover a categoria "${cat}"? (Transações antigas manterão este nome para histórico).`)) return;

      // Remove da lista principal
      data.categories[type] = data.categories[type].filter(c => c !== cat);
      // Remove do filtro ativo
      filters.categories.delete(cat);

      await persist();
      renderCategoriesList();
      renderCategoryFilter();
      populateModalSelects();
      renderAll();
    };
  });
}

async function onAddCategory(e) {
  e.preventDefault();
  const name = document.getElementById('newCategoryName').value.trim();
  const type = document.getElementById('newCategoryType').value;
  
  if (!name) return;

  // Verifica categoria duplicada
  if (data.categories.income.includes(name) || data.categories.expense.includes(name)) {
    alert('Esta categoria já existe.');
    return;
  }

  data.categories[type].push(name);

  filters.categories.add(name);

  document.getElementById('newCategoryName').value = '';

  await persist();
  renderCategoriesList();
  renderCategoryFilter();
  populateModalSelects();
  renderAll();
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
  return data.bills.filter(b => !billsFilter.month || monthKey(b.vencimento) === billsFilter.month);
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
  document.getElementById('billPersonId').value = bill ? (bill.personId || '') : '';
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
  const record = {
    id: id || 'b' + Date.now(),
    conta: document.getElementById('billConta').value.trim(),
    vencimento: document.getElementById('billVencimento').value,
    valorReferencia: parseFloat(document.getElementById('billValorReferencia').value) || 0,
    formaPagamento: document.getElementById('billFormaPagamento').value,
    banco: document.getElementById('billBanco').value.trim(),
    personId: document.getElementById('billPersonId').value || null,
    valorPago: valorPagoRaw === '' ? null : parseFloat(valorPagoRaw),
    comprovante: document.getElementById('billComprovante').value.trim()
  };
  if (id) {
    const idx = data.bills.findIndex(b => b.id === id);
    data.bills[idx] = record;
  } else {
    data.bills.push(record);
  }
  await persist();
  closeBillModal();
  renderBillsView();
}

async function onDeleteBill() {
  const id = document.getElementById('billId').value;
  if (!id || !confirm('Excluir esta conta?')) return;
  data.bills = data.bills.filter(b => b.id !== id);
  await persist();
  closeBillModal();
  renderBillsView();
}

init();
