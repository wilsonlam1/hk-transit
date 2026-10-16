import { LINES, lineStations, mtrTrip, trainServes, stationName } from './mtr-data.js';
import { mtrSchedule, searchRoute, CO_NAME, CO_COLOR } from './api.js';
import { startMtrTrip, startBusTrip, fireAlert, ensureNotifyPermission } from './trip.js';

/* ---------------- 小工具 ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const minsFrom = d => Math.max(0, Math.round((d - Date.now()) / 60000));
const hhmm = d => d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });

const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

export const settings = Object.assign({ lead: '60', perStop: 2, vibrate: true, sound: true }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ---------------- 底部選單 ---------------- */
let currentView = 'mtr';
function showView(v) {
  currentView = v;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${v}`));
  $$('.nav-btn').forEach(b => {
    const on = b.dataset.view === v;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#bus-bar').classList.toggle('hidden', v !== 'bus' || !busReady());
  if (v === 'mtr') refreshMtr();
  if (v === 'favs') renderFavs();
  window.scrollTo(0, 0);
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

/* ================= 港鐵 ================= */
const mtr = Object.assign({ line: 'TML', from: 'TWW', to: 'ETS' }, store.get('mtr', {}));
let mtrTrains = [];

function fillMtrSelects() {
  $('#mtr-line').innerHTML = Object.entries(LINES)
    .map(([k, l]) => `<option value="${k}" ${k === mtr.line ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const sts = lineStations(mtr.line);
  if (!sts.includes(mtr.from)) mtr.from = sts[0];
  if (!sts.includes(mtr.to) || mtr.to === mtr.from) mtr.to = sts[sts.length - 1];
  const opts = sel => sts.map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${esc(stationName(s))}</option>`).join('');
  $('#mtr-from').innerHTML = opts(mtr.from);
  $('#mtr-to').innerHTML = opts(mtr.to);
}

$('#mtr-line').addEventListener('change', e => { mtr.line = e.target.value; fillMtrSelects(); refreshMtr(); });
$('#mtr-from').addEventListener('change', e => { mtr.from = e.target.value; refreshMtr(); });
$('#mtr-to').addEventListener('change', e => { mtr.to = e.target.value; refreshMtr(); });
$('#mtr-swap').addEventListener('click', () => { [mtr.from, mtr.to] = [mtr.to, mtr.from]; fillMtrSelects(); refreshMtr(); });
$('#mtr-fav').addEventListener('click', () => {
  addFav({ type: 'mtr', line: mtr.line, from: mtr.from, to: mtr.to });
});

async function refreshMtr() {
  store.set('mtr', mtr);
  const list = $('#mtr-list');
  const L = LINES[mtr.line];
  const trip = mtrTrip(mtr.line, mtr.from, mtr.to);
  if (!trip) {
    list.innerHTML = `<div class="empty">上車站同落車站要唔同，而且要喺同一條綫（試用版未支援轉綫）。</div>`;
    $('#mtr-meta').textContent = '';
    return;
  }
  if (!list.children.length || list.querySelector('.empty')) list.innerHTML = `<div class="empty">載入緊…</div>`;
  try {
    const s = await mtrSchedule(mtr.line, mtr.from);
    mtrTrains = [...s.up, ...s.down]
      .filter(t => trainServes(mtr.line, mtr.from, mtr.to, t.dest))
      .sort((a, b) => a.time - b.time)
      .slice(0, 4);
    if (!mtrTrains.length) {
      list.innerHTML = `<div class="empty">暫時冇往呢個方向嘅班次資料。</div>`;
    } else {
      list.innerHTML = mtrTrains.map((t, i) => `
        <div class="item">
          <span class="chip" style="background:${L.color};color:${L.text}">${esc(L.name)}</span>
          <div class="grow">
            <span class="t1">往 ${esc(stationName(t.dest))}</span>
            <span class="t2">${t.plat} 號月台 · ${hhmm(t.time)} 開</span>
          </div>
          <span class="mins ${i === 0 ? 'first' : ''}">${minsFrom(t.time)}<small>分</small></span>
          <button class="small-btn ${i === 0 ? 'accent' : ''}" data-train="${i}">搭呢班</button>
        </div>`).join('');
    }
    const arrive = new Date((mtrTrains[0]?.time || Date.now()) * 1 + trip.stops * settings.perStop * 60000);
    $('#mtr-meta').textContent = `${hhmm(new Date())} 更新 · ${trip.stops} 個站` + (s.delay ? ' · 港鐵表示服務有延誤' : '') +
      (mtrTrains[0] ? ` · 搭第一班約 ${hhmm(arrive)} 到${stationName(mtr.to)}（估計）` : '');
  } catch (e) {
    list.innerHTML = `<div class="empty">攞唔到班次：${esc(e.message)}。請檢查網絡再試。</div>`;
  }
}
$('#mtr-list').addEventListener('click', e => {
  const b = e.target.closest('[data-train]');
  if (!b) return;
  const t = mtrTrains[Number(b.dataset.train)];
  startMtrTrip({ line: mtr.line, from: mtr.from, to: mtr.to, train: t, settings });
});
setInterval(() => { if (currentView === 'mtr' && !document.hidden && $('#trip').classList.contains('hidden')) refreshMtr(); }, 15000);

/* ================= 巴士 / 小巴 ================= */
const bus = { co: 'KMB', dirs: [], dir: null, stops: [], board: null, alight: null, open: null, loading: false };
const busReady = () => bus.dir && bus.board != null && bus.alight != null;

$$('[data-co]').forEach(b => b.addEventListener('click', () => {
  bus.co = b.dataset.co;
  $$('[data-co]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
  resetBus();
  if ($('#bus-route').value.trim()) doSearch();
}));
$('#bus-form').addEventListener('submit', e => { e.preventDefault(); doSearch(); });

function resetBus() {
  Object.assign(bus, { dirs: [], dir: null, stops: [], board: null, alight: null, open: null });
  $('#bus-dirs').innerHTML = '';
  $('#bus-stops').innerHTML = '';
  updateBusBar();
}

async function doSearch(preferKey) {
  const route = $('#bus-route').value.trim().toUpperCase();
  resetBus();
  if (!route) return;
  $('#bus-dirs').innerHTML = `<p class="meta">搵緊 ${esc(CO_NAME[bus.co])} ${esc(route)}…</p>`;
  try {
    bus.dirs = await searchRoute(bus.co, route);
  } catch (e) {
    $('#bus-dirs').innerHTML = `<p class="meta">搵唔到資料：${esc(e.message)}</p>`;
    return;
  }
  if (!bus.dirs.length) {
    $('#bus-dirs').innerHTML = `<p class="meta">搵唔到 ${esc(CO_NAME[bus.co])} ${esc(route)}。檢查下路線號碼同公司啱唔啱。</p>`;
    return;
  }
  renderDirs();
  const pick = bus.dirs.find(d => d.key === preferKey);
  if (pick) return selectDir(pick);
  if (bus.dirs.length === 1) return selectDir(bus.dirs[0]);
}

function renderDirs() {
  $('#bus-dirs').innerHTML = bus.dirs.map((d, i) => `
    <button class="dir-btn ${bus.dir === d ? 'on' : ''}" data-dir="${i}">
      <b>${esc(d.label)}</b><span>${esc(d.sub)}</span>
    </button>`).join('');
}
$('#bus-dirs').addEventListener('click', e => {
  const b = e.target.closest('[data-dir]');
  if (b) selectDir(bus.dirs[Number(b.dataset.dir)]);
});

async function selectDir(d) {
  bus.dir = d; bus.board = null; bus.alight = null; bus.open = null;
  renderDirs();
  $('#bus-stops').innerHTML = `<div class="empty">載入車站緊…</div>`;
  try {
    bus.stops = await d.loadStops();
  } catch (e) {
    $('#bus-stops').innerHTML = `<div class="empty">攞唔到車站：${esc(e.message)}</div>`;
    return;
  }
  renderStops();
  updateBusBar();
}

function renderStops() {
  $('#bus-stops').innerHTML = bus.stops.map((s, i) => {
    const cls = i === bus.board ? 'board' : i === bus.alight ? 'alight' : '';
    const tag = i === bus.board ? '（上車）' : i === bus.alight ? '（落車）' : '';
    const open = bus.open === i;
    return `
      <div class="stop-wrap">
        <button class="stop-row" data-stop="${i}" aria-expanded="${open}">
          <span class="seq ${cls}">${i + 1}</span>
          <span class="grow"><span class="t1">${esc(s.name)} ${tag}</span></span>
        </button>
        ${open ? `<div class="stop-detail">
          <span class="eta-txt" id="eta-${i}">攞緊到站時間…</span>
          <button class="small-btn" data-board="${i}">喺呢度上車</button>
          <button class="small-btn accent" data-alight="${i}">喺呢度落車</button>
        </div>` : ''}
      </div>`;
  }).join('');
  if (bus.open != null) loadEta(bus.open);
}

async function loadEta(i) {
  const el = () => document.getElementById(`eta-${i}`);
  try {
    const etas = (await bus.dir.eta(bus.stops[i])).filter(x => x.time);
    if (!el()) return;
    el().innerHTML = etas.length
      ? '下一班：' + etas.slice(0, 3).map((x, k) =>
          k === 0 ? `<b>${minsFrom(x.time)} 分鐘</b>` : `${minsFrom(x.time)} 分`).join(' · ') +
        (etas[0].rmk ? `（${esc(etas[0].rmk)}）` : '')
      : '暫時冇班次資料';
  } catch (e) {
    if (el()) el().textContent = '攞唔到到站時間';
  }
}

$('#bus-stops').addEventListener('click', e => {
  const row = e.target.closest('[data-stop]');
  const b = e.target.closest('[data-board]');
  const a = e.target.closest('[data-alight]');
  if (b) {
    bus.board = Number(b.dataset.board);
    if (bus.alight != null && bus.alight <= bus.board) bus.alight = null;
  } else if (a) {
    const idx = Number(a.dataset.alight);
    if (bus.board != null && idx <= bus.board) { toast('落車站要喺上車站之後'); return; }
    bus.alight = idx;
    if (bus.board == null) bus.board = 0;
  } else if (row) {
    const i = Number(row.dataset.stop);
    bus.open = bus.open === i ? null : i;
  } else return;
  renderStops();
  updateBusBar();
});

function updateBusBar() {
  const ok = busReady();
  $('#bus-bar').classList.toggle('hidden', !ok || currentView !== 'bus');
  if (!ok) return;
  const n = bus.alight - bus.board;
  $('#bus-bar-text').innerHTML =
    `<b>${esc(CO_NAME[bus.dir.co])} ${esc(bus.dir.route)}</b> · ${esc(bus.stops[bus.board].name)} → <b>${esc(bus.stops[bus.alight].name)}</b> · ${n} 個站`;
}
$('#bus-start').addEventListener('click', () => {
  if (!busReady()) return;
  startBusTrip({ dir: bus.dir, stops: bus.stops, board: bus.board, alight: bus.alight, settings });
});
$('#bus-fav').addEventListener('click', () => {
  if (!busReady()) return;
  addFav({
    type: 'bus', co: bus.dir.co, route: bus.dir.route, key: bus.dir.key, label: bus.dir.label,
    boardSeq: bus.stops[bus.board].seq, alightSeq: bus.stops[bus.alight].seq,
    boardName: bus.stops[bus.board].name, alightName: bus.stops[bus.alight].name
  });
});

/* ================= 收藏 ================= */
let favs = store.get('favs', []);
const favId = f => f.type === 'mtr' ? `mtr|${f.line}|${f.from}|${f.to}` : `bus|${f.key}|${f.boardSeq}|${f.alightSeq}`;
function addFav(f) {
  if (favs.some(x => favId(x) === favId(f))) { toast('已經收藏咗'); return; }
  favs.push(f);
  store.set('favs', favs);
  toast('已加入收藏');
}
function renderFavs() {
  const list = $('#fav-list');
  if (!favs.length) {
    list.innerHTML = `<div class="empty">未有收藏。喺港鐵或者巴士頁撳「☆ 收藏」。</div>`;
    return;
  }
  list.innerHTML = favs.map((f, i) => {
    if (f.type === 'mtr') {
      const L = LINES[f.line];
      return `<div class="item">
        <span class="chip" style="background:${L.color};color:${L.text}">${esc(L.name)}</span>
        <button class="grow stop-row" data-open="${i}"><span class="t1">${esc(stationName(f.from))} → ${esc(stationName(f.to))}</span></button>
        <button class="small-btn" data-del="${i}" aria-label="刪除收藏">刪除</button></div>`;
    }
    return `<div class="item">
      <span class="chip" style="background:${CO_COLOR[f.co]};color:#fff">${esc(CO_NAME[f.co])} ${esc(f.route)}</span>
      <button class="grow stop-row" data-open="${i}" style="flex-direction:column;align-items:flex-start;gap:2px">
        <span class="t1">${esc(f.boardName)} → ${esc(f.alightName)}</span><span class="t2">${esc(f.label)}</span></button>
      <button class="small-btn" data-del="${i}" aria-label="刪除收藏">刪除</button></div>`;
  }).join('');
}
$('#fav-list').addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  const open = e.target.closest('[data-open]');
  if (del) {
    favs.splice(Number(del.dataset.del), 1);
    store.set('favs', favs);
    renderFavs();
    return;
  }
  if (!open) return;
  const f = favs[Number(open.dataset.open)];
  if (f.type === 'mtr') {
    Object.assign(mtr, { line: f.line, from: f.from, to: f.to });
    fillMtrSelects();
    showView('mtr');
  } else {
    bus.co = f.co;
    $$('[data-co]').forEach(x => { const on = x.dataset.co === f.co; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    $('#bus-route').value = f.route;
    showView('bus');
    await doSearch(f.key);
    if (bus.dir && bus.dir.key === f.key) {
      bus.board = bus.stops.findIndex(s => s.seq === f.boardSeq);
      bus.alight = bus.stops.findIndex(s => s.seq === f.alightSeq);
      if (bus.board < 0) bus.board = null;
      if (bus.alight < 0) bus.alight = null;
      renderStops();
      updateBusBar();
    }
  }
});

/* ================= 設定 ================= */
function renderSettings() {
  $$('[data-lead]').forEach(b => {
    const on = b.dataset.lead === settings.lead;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  $('#set-vibrate').checked = settings.vibrate;
  $('#set-sound').checked = settings.sound;
  $('#set-perstop').value = settings.perStop;
  const p = ('Notification' in window) ? Notification.permission : 'unsupported';
  $('#perm-state').textContent = {
    granted: '通知：已開啟', denied: '通知：已被封鎖，要去瀏覽器設定重新開', default: '通知：未開啟',
    unsupported: '呢個瀏覽器唔支援通知（iPhone 要先「加入主畫面」）'
  }[p];
}
$$('[data-lead]').forEach(b => b.addEventListener('click', () => { settings.lead = b.dataset.lead; saveSettings(); renderSettings(); }));
$('#set-vibrate').addEventListener('change', e => { settings.vibrate = e.target.checked; saveSettings(); });
$('#set-sound').addEventListener('change', e => { settings.sound = e.target.checked; saveSettings(); });
$('#set-perstop').addEventListener('change', e => {
  const v = Math.min(5, Math.max(1, Number(e.target.value) || 2));
  settings.perStop = v; saveSettings(); renderSettings();
});
$('#btn-perm').addEventListener('click', async () => { await ensureNotifyPermission(); renderSettings(); });
$('#btn-test').addEventListener('click', async () => {
  await ensureNotifyPermission();
  renderSettings();
  fireAlert({ settings, chip: '測試', stop: '尖東', action: '準備落車', sub: '呢個係測試提示' });
});

/* ================= 開始 ================= */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
fillMtrSelects();
renderSettings();
showView('mtr');
