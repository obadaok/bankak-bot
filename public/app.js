const REFRESH_INTERVAL_MS = 5000;
const PAGE_SIZE = 10;

let currentPage = 0;
let totalReports = 0;
let sessionTimeoutMs = 60000;

function getToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) localStorage.setItem('dashboard_token', fromUrl);
  return localStorage.getItem('dashboard_token') || '';
}

async function apiFetch(path) {
  const token = getToken();
  const headers = token ? { 'x-dashboard-token': token } : {};
  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error('Request failed: ' + res.status);
  return res.json();
}

function formatMoney(n) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  const d = new Date(value);
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(online) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  dot.classList.toggle('online', online);
  dot.classList.toggle('offline', !online);
  text.textContent = online ? 'متصل' : 'تعذر الاتصال بالخادم';
}

async function loadSummary() {
  try {
    const data = await apiFetch('/api/summary');
    sessionTimeoutMs = data.sessionTimeoutMs || sessionTimeoutMs;
    document.getElementById('statActive').textContent = data.activeSessions ?? 0;
    document.getElementById('statReports').textContent = data.totalReports ?? 0;
    document.getElementById('statAmount').textContent = formatMoney(data.totalAmount);
    document.getElementById('statOps').textContent = data.totalOperations ?? 0;
    setStatus(true);
  } catch (e) {
    setStatus(false);
  }
}

function sessionCardHtml(s) {
  const percent = Math.min(100, Math.round((s.remainingMs / sessionTimeoutMs) * 100));
  return `
    <div class="session-card">
      <div class="session-top">
        <span>${escapeHtml(s.senderId)}</span>
        <span>🟢</span>
      </div>
      <div class="session-metrics">
        <span>${s.totalCount} عملية</span>
        <span>${formatMoney(s.totalAmount)}</span>
      </div>
      <div class="timer-bar-track">
        <div class="timer-bar-fill" style="width:${percent}%"></div>
      </div>
      <div class="session-timer">⏳ ${formatCountdown(s.remainingMs)}</div>
    </div>
  `;
}

async function loadActiveSessions() {
  const container = document.getElementById('activeSessions');
  const empty = document.getElementById('activeEmpty');
  const badge = document.getElementById('activeCountBadge');

  try {
    const data = await apiFetch('/api/sessions');
    badge.textContent = data.sessions.length;

    if (data.sessions.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    container.innerHTML = data.sessions.map(sessionCardHtml).join('');
    setStatus(true);
  } catch (e) {
    setStatus(false);
  }
}

function reportRowHtml(r) {
  return `
    <div class="report-row">
      <div class="report-date">
        <div class="col-label">التاريخ</div>
        ${formatDate(r.endedAt)}
      </div>
      <div class="report-count">
        <div class="col-label">العمليات</div>
        ${r.totalCount} عملية
      </div>
      <div class="report-amount">
        <div class="col-label">الإجمالي</div>
        ${formatMoney(r.totalAmount)}
      </div>
      <button class="btn-view" data-id="${r.id}">📄 التفاصيل</button>
    </div>
  `;
}

async function loadReports() {
  const container = document.getElementById('reportsList');
  const empty = document.getElementById('reportsEmpty');
  const pageInfo = document.getElementById('pageInfo');
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');

  try {
    const data = await apiFetch(`/api/reports?limit=${PAGE_SIZE}&skip=${currentPage * PAGE_SIZE}`);
    totalReports = data.total;

    if (data.reports.length === 0 && currentPage === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      container.innerHTML = data.reports.map(reportRowHtml).join('');
      container.querySelectorAll('.btn-view').forEach((btn) => {
        btn.addEventListener('click', () => openReportModal(btn.dataset.id));
      });
    }

    const totalPages = Math.max(1, Math.ceil(totalReports / PAGE_SIZE));
    pageInfo.textContent = `صفحة ${currentPage + 1} / ${totalPages}`;
    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = currentPage + 1 >= totalPages;

    setStatus(true);
  } catch (e) {
    setStatus(false);
  }
}

document.getElementById('prevPage').addEventListener('click', () => {
  if (currentPage > 0) {
    currentPage -= 1;
    loadReports();
  }
});

document.getElementById('nextPage').addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(totalReports / PAGE_SIZE));
  if (currentPage + 1 < totalPages) {
    currentPage += 1;
    loadReports();
  }
});

function accountsListHtml(accounts) {
  if (!accounts || accounts.length === 0) {
    return '<p class="muted">لا توجد حسابات مسجلة</p>';
  }
  return `
    <div class="accounts-list">
      ${accounts
        .map(
          (a, i) => `
        <div class="account-row">
          <span class="account-idx">${i + 1}</span>
          <div class="account-info">
            <strong>${escapeHtml(a.name)}</strong>
            <span class="muted">${escapeHtml(a.accountNumber)}</span>
          </div>
          <div class="account-numbers">
            <span>${a.count} عملية</span>
            <span class="amount">${formatMoney(a.total)}</span>
          </div>
        </div>`
        )
        .join('')}
    </div>
  `;
}

async function openReportModal(id) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  content.innerHTML = '<p class="muted">جاري التحميل...</p>';
  overlay.classList.add('open');

  try {
    const r = await apiFetch(`/api/reports/${id}`);
    content.innerHTML = `
      <h3>📊 تقرير جلسة — ${escapeHtml(r.senderId)}</h3>
      <div class="modal-summary">
        <div>🗓️ ${formatDate(r.endedAt)}</div>
        <div>🔢 ${r.totalCount} عملية</div>
        <div>💰 ${formatMoney(r.totalAmount)}</div>
      </div>
      ${accountsListHtml(r.accounts)}
    `;
  } catch (e) {
    content.innerHTML = '<p class="muted">تعذر تحميل التفاصيل</p>';
  }
}

document.getElementById('modalClose').addEventListener('click', () => {
  document.getElementById('modalOverlay').classList.remove('open');
});
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') {
    e.currentTarget.classList.remove('open');
  }
});

function refreshAll() {
  loadSummary();
  loadActiveSessions();
}

loadSummary();
loadActiveSessions();
loadReports();

setInterval(refreshAll, REFRESH_INTERVAL_MS);
