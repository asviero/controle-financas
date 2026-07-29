/* ===== Estado ===== */
let data = { people: [], categories: { income: [], expense: [] }, budgets: [], transactions: [], startingCashBalance: {}, bills: [], paymentMethods: [] };

let filters = { personIds: new Set() };
let billsFilter = { month: null };

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

  if (!Array.isArray(data.bills)) data.bills = [];
  if (!Array.isArray(data.paymentMethods)) data.paymentMethods = ["Boleto", "Pix", "Cartão de Crédito", "Débito Automático", "Transferência", "Dinheiro", "Outro"];
  
  billsFilter.month = todayMonth();
  document.getElementById('billsMonth').value = billsFilter.month;

  renderPeopleFilter();
  populateBillModalSelects();
  bindEvents();
  
  await ensureFixedBillsForMonth(billsFilter.month);
  renderBillsView();
}

async function persist() {
  await window.financeAPI.saveData(data);
}

/* ===== Filtros de Pessoas ===== */
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
      renderBillsView();
    };
    el.appendChild(chip);
  });
}

function bindEvents() {
  document.getElementById('devLink').onclick = (e) => {
    e.preventDefault();
    window.financeAPI.openLink('https://www.linkedin.com/in/asviero/');
  };

  document.getElementById('billsSearch').oninput = renderBillsTable;

  // Backup no Drive
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

  // Restaurar Backup
  document.getElementById('importBackupBtn').onclick = async () => {
    if (!(await askConfirm('ATENÇÃO: Restaurar um backup irá apagar e substituir TODOS os seus dados atuais. Deseja continuar?'))) return;
    
    try {
      const result = await window.financeAPI.restoreBackup();
      if (result && result.canceled) return; 
      
      if (result && result.success) {
        data = result.data;
        await init(); 
        await askAlert('Backup restaurado com sucesso! Os seus dados foram recuperados.');
      } else {
        await askAlert('Erro ao restaurar backup: ' + (result?.message || 'Arquivo inválido.'));
      }
    } catch (err) {
      console.error(err);
      await askAlert('Falha de comunicação ao processar o arquivo.');
    }
  };

  document.getElementById('resetBtn').onclick = async () => {
    if (!(await askConfirm('ATENÇÃO: Deseja apagar todos os dados do banco SQLite? Esta ação não pode ser desfeita.'))) return;
    data = await window.financeAPI.resetToSample();
    await init();
  };

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
        v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      } else {
        v = v.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
      }
      e.target.value = v;
    });
  };

  maskInput(inputCpf, 'cpf');
  maskInput(inputCnpj, 'cnpj');

  // Contas a pagar: navegação e modal
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

  document.getElementById('addBillBtn').onclick = () => openBillModal();
  document.getElementById('billCancelBtn').onclick = closeBillModal;
  document.getElementById('billForm').onsubmit = onSaveBill;
  document.getElementById('billDeleteBtn').onclick = onDeleteBill;

  const billRepetition = document.getElementById('billRepetition');
  if (billRepetition) {
    billRepetition.onchange = (e) => {
      document.getElementById('installmentCountWrap').style.display = e.target.value === 'installment' ? 'block' : 'none';
    };
  }

  // Exportar planilha
  document.getElementById('exportBillsBtn').onclick = async () => {
    const filteredBills = getFilteredBills();

    if (filteredBills.length === 0) {
      await askAlert('Não há contas para exportar neste período.');
      return;
    }

    const totalPaid = filteredBills.reduce((acc, b) => acc + (b.valorPago || 0), 0);
    const periodLabel = billsFilter.month ? billsFilter.month : 'Todos os períodos';
    
    const extraInfo = {
      period: periodLabel,
      totalPaid: totalPaid
    };

    const billsToExport = filteredBills.map(b => {
      const pessoa = data.people.find(p => p.id === b.personId);
      const statusId = computeBillStatus(b);
      
      let parcelasText = 'Única';
      if (b.isFixed) parcelasText = 'Fixa';
      if (b.isInstallment) parcelasText = `${b.currentInstallment}/${b.totalInstallments}`;

      return {
        "Conta": b.conta,
        "Vencimento": formatDate(b.vencimento),
        "Mês de Referência": monthKey(b.vencimento),
        "Parcelas": parcelasText,
        "Valor de Referência (R$)": b.valorReferencia || 0,
        "Valor Pago (R$)": b.valorPago || 0,
        "Status": STATUS_LABELS[statusId],
        "Forma de Pagamento": b.formaPagamento || '',
        "Banco": b.banco || '',
        "Pessoa": pessoa ? pessoa.name : '—',
        "Comprovante": b.comprovante || ''
      };
    });

    let defaultFilename = 'Contas_Todas.xlsx';
    if (filters.personIds.size > 0) {
      const activePersonId = Array.from(filters.personIds)[0];
      const person = data.people.find(p => p.id === activePersonId);
      if (person) {
        const safeName = person.name.replace(/\s+\(/, '_').replace(/\)/, '').replace(/\s+/g, '_');
        defaultFilename = `Contas_${safeName}.xlsx`;
      }
    }

    try {
      const result = await window.financeAPI.exportBillsSpreadsheet(billsToExport, defaultFilename, extraInfo);
      if (result && result.success) {
        await askAlert('Planilha exportada com sucesso!\nSalva em: ' + result.filePath);
      } else if (result && result.message) {
        await askAlert('Erro ao exportar: ' + result.message);
      }
    } catch (err) {
      console.error(err);
      await askAlert('Ocorreu um erro inesperado ao exportar.');
    }
  };
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function shiftBillsMonth(delta) {
  const base = billsFilter.month || todayMonth();
  let [y, m] = base.split('-').map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
  billsFilter.month = `${y}-${String(m).padStart(2, '0')}`;
  document.getElementById('billsMonth').value = billsFilter.month;
  
  ensureFixedBillsForMonth(billsFilter.month).then(() => renderBillsView());
}

/* ===== Modal Pessoas ===== */
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
      data.transactions = data.transactions.filter(t => t.personId !== id); // Mantido por segurança na base
      data.budgets = data.budgets.filter(b => b.personId !== id);
      data.bills.forEach(b => { if (b.personId === id) b.personId = null; });
      delete data.startingCashBalance[id];
      filters.personIds.delete(id);

      renderPeopleList();
      renderPeopleFilter();
      populateBillModalSelects();
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
  const createProfile = (idSuffix, nameSuffix, pTipo, pCpf, pCnpj) => {
    const id = baseId + idSuffix;
    data.people.push({
      id, name: name + nameSuffix, color, tipo: pTipo,
      cpf: pCpf, cnpj: pCnpj
    });
    data.startingCashBalance[id] = 0;
    if (filters.personIds.size === 0) filters.personIds.add(id);
  };

  if (tipo === 'PF' || tipo === 'Ambos') createProfile(tipo === 'Ambos' ? '_PF' : '', ' (PF)', 'PF', cpf, '');
  if (tipo === 'PJ' || tipo === 'Ambos') createProfile(tipo === 'Ambos' ? '_PJ' : '', ' (PJ)', 'PJ', '', cnpj);
  
  document.getElementById('newPersonName').value = '';
  document.getElementById('newPersonCpf').value = '';
  document.getElementById('newPersonCnpj').value = '';
  window.focus();
  document.getElementById('newPersonName').focus();
  
  renderPeopleList();
  renderPeopleFilter();
  populateBillModalSelects();
  
  setTimeout(async () => {
    renderBillsView();
    await persist();
  }, 10);
}

/* ===== Contas a Pagar ===== */
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
  const currentMonthStr = todayMonth();
  return data.bills.filter(b => {
    const matchMonth = billsFilter.month
      ? monthKey(b.vencimento) === billsFilter.month
      : monthKey(b.vencimento) <= currentMonthStr;
    const matchPerson = filters.personIds.has(b.personId);
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
  document.getElementById('billsPeriodLabel').textContent = billsFilter.month ? billsFilter.month : 'Todos os períodos';

  // Atualiza o Título com o nome da pessoa
  let title = 'Contas a pagar';
  if (filters.personIds.size > 0) {
    const activePersonId = Array.from(filters.personIds)[0];
    const person = data.people.find(p => p.id === activePersonId);
    if (person) {
      title = `Contas a pagar - ${person.name}`;
    }
  }
  const titleEl = document.getElementById('billsMainTitle');
  if (titleEl) titleEl.textContent = title;

  const bills = getFilteredBills();
  const total = bills.reduce((s, b) => s + (b.valorReferencia || 0), 0);
  const paid = bills.filter(b => computeBillStatus(b) === 'pago').reduce((s, b) => s + (b.valorPago || 0), 0);
  const pending = bills.filter(b => computeBillStatus(b) !== 'pago').reduce((s, b) => s + (b.valorReferencia || 0), 0);
  const overdueCount = bills.filter(b => computeBillStatus(b) === 'atrasado').length;

  document.getElementById('billsKpiTotal').textContent = fmtBRL(total);
  document.getElementById('billsKpiPaid').textContent = fmtBRL(paid);
  document.getElementById('billsKpiPending').textContent = fmtBRL(pending);
  document.getElementById('billsKpiOverdue').textContent = overdueCount;

  renderBillsTable();
}

function renderBillsTable() {
  const search = (document.getElementById('billsSearch').value || '').toLowerCase();

  const rows = getFilteredBills()
    .filter(b => b.conta.toLowerCase().includes(search))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const body = document.getElementById('billsTableBody');
  body.innerHTML = rows.map(b => {
    const status = computeBillStatus(b);
    const comprovanteCell = b.comprovante
      ? `<a href="${b.comprovante}" class="comprovante-link" target="_blank" onclick="event.stopPropagation()">Ver</a>`
      : '—';

    let parcelasText = '<span class="hint">Única</span>';
    if (b.isFixed) parcelasText = 'Fixa';
    if (b.isInstallment) parcelasText = `<strong>${b.currentInstallment}/${b.totalInstallments}</strong>`;

    return `
    <tr data-id="${b.id}" class="row-${status}">
      <td>${b.conta}</td>
      <td>${parcelasText}</td>
      <td>${formatDate(b.vencimento)}</td>
      <td>${monthKey(b.vencimento)}</td>
      <td class="num">${fmtBRL(b.valorReferencia || 0)}</td>
      <td>${b.formaPagamento || '—'}</td>
      <td>${b.banco || '—'}</td>
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
  
  let activePerson = '';
  if (bill) {
    activePerson = bill.personId || '';
  } else if (filters.personIds.size > 0) {
    activePerson = Array.from(filters.personIds)[0];
  }
  document.getElementById('billPersonId').value = activePerson;
  document.getElementById('billValorPago').value = bill && bill.valorPago !== null && bill.valorPago !== undefined ? bill.valorPago : '';
  document.getElementById('billComprovante').value = bill ? bill.comprovante : '';
  
  const repSelect = document.getElementById('billRepetition');
  const instWrap = document.getElementById('installmentCountWrap');
  
  if (bill) {
    repSelect.disabled = true;
    if (bill.isInstallment) {
      repSelect.value = 'installment';
      instWrap.style.display = 'block';
      document.getElementById('billInstallmentsCount').value = bill.totalInstallments;
      document.getElementById('billInstallmentsCount').disabled = true;
    } else if (bill.isFixed) {
      repSelect.value = 'fixed';
      instWrap.style.display = 'none';
    } else {
      repSelect.value = 'none';
      instWrap.style.display = 'none';
    }
  } else {
    repSelect.disabled = false;
    repSelect.value = 'none';
    instWrap.style.display = 'none';
    document.getElementById('billInstallmentsCount').value = 2;
    document.getElementById('billInstallmentsCount').disabled = false;
  }

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
  
  const repType = document.getElementById('billRepetition').value;
  const totalInst = parseInt(document.getElementById('billInstallmentsCount').value) || 2;
  
  const baseRecord = {
    conta: document.getElementById('billConta').value.trim(),
    vencimento: document.getElementById('billVencimento').value,
    valorReferencia: parseFloat(document.getElementById('billValorReferencia').value) || 0,
    formaPagamento: document.getElementById('billFormaPagamento').value,
    banco: document.getElementById('billBanco').value.trim(),
    personId: document.getElementById('billPersonId').value || null,
    valorPago: valorPagoRaw === '' ? null : parseFloat(valorPagoRaw),
    comprovante: document.getElementById('billComprovante').value.trim()
  };

  const addMonths = (dateStr, num) => {
    let [y, m, d] = dateStr.split('-').map(Number);
    m += num;
    while (m > 12) { m -= 12; y++; }
    const lastDay = new Date(y, m, 0).getDate();
    if (d > lastDay) d = lastDay;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  if (id) {
    const idx = data.bills.findIndex(b => b.id === id);
    const existing = data.bills[idx];
    
    baseRecord.id = id;
    baseRecord.isFixed = existing.isFixed;
    baseRecord.fixedGroupId = existing.fixedGroupId;
    baseRecord.isInstallment = existing.isInstallment;
    baseRecord.currentInstallment = existing.currentInstallment;
    baseRecord.totalInstallments = existing.totalInstallments;
    baseRecord.installmentGroupId = existing.installmentGroupId;
    
    data.bills[idx] = baseRecord;
  } else {
    if (repType === 'installment') {
      const groupId = 'inst_' + Date.now();
      for (let i = 1; i <= totalInst; i++) {
        const instRecord = { ...baseRecord };
        instRecord.id = 'b' + Date.now() + '_' + i;
        instRecord.vencimento = addMonths(baseRecord.vencimento, i - 1);
        instRecord.isFixed = false;
        instRecord.isInstallment = true;
        instRecord.currentInstallment = i;
        instRecord.totalInstallments = totalInst;
        instRecord.installmentGroupId = groupId;
        if (i > 1) {
          instRecord.valorPago = null;
          instRecord.comprovante = '';
        }
        data.bills.push(instRecord);
      }
    } else if (repType === 'fixed') {
      baseRecord.id = 'b' + Date.now();
      baseRecord.isFixed = true;
      baseRecord.fixedGroupId = 'fix_' + Date.now();
      data.bills.push(baseRecord);
    } else {
      baseRecord.id = 'b' + Date.now();
      data.bills.push(baseRecord);
    }
  }
  
  await persist();
  closeBillModal();
  await ensureFixedBillsForMonth(monthKey(baseRecord.vencimento));
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

/* ===== Clonador de Contas Fixas ===== */
async function ensureFixedBillsForMonth(monthStr) {
  if (!monthStr) return;
  let added = false;

  const fixedTemplates = new Map();
  const fixedStarts = new Map();

  data.bills.forEach(b => {
    if (b.isFixed) {
        if (!fixedTemplates.has(b.fixedGroupId) || b.vencimento > fixedTemplates.get(b.fixedGroupId).vencimento) {
          fixedTemplates.set(b.fixedGroupId, b);
        }
        if (!fixedStarts.has(b.fixedGroupId) || b.vencimento < fixedStarts.get(b.fixedGroupId).vencimento) {
          fixedStarts.set(b.fixedGroupId, b.vencimento);
        }
    }
  });

  fixedTemplates.forEach(template => {
    const startMonth = fixedStarts.get(template.fixedGroupId).slice(0, 7);
    if (monthStr < startMonth) return;

    const existsInMonth = data.bills.some(b => b.fixedGroupId === template.fixedGroupId && monthKey(b.vencimento) === monthStr);
    
    if (!existsInMonth) {
        const day = template.vencimento.split('-')[2];
        let targetDate = `${monthStr}-${day}`;
        
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

init();