import { LINES, mtrTrip, stationName } from './mtr-data.js';
import { mtrSchedule, CO_NAME, CO_COLOR } from './api.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = d => d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
const LEAD_TEXT = { '30': '到站前 30 秒', '60': '到站前 1 分鐘', '120': '到站前 2 分鐘', prev: '到前一站時' };
// 巴士冇時間表，用距離估：巴士市區平均大約每分鐘行 400–500 米
const LEAD_METERS = { '30': 250, '60': 500, '120': 1000 };

let active = null;   // 目前行程
let wakeLock = null;
let audioCtx = null;
let map = null, mapLayers = [];

/* ---------------- 通知、震動、聲 ---------------- */
export async function ensureNotifyPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch (e) { return 'default'; }
  }
  return Notification.permission;
}

function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [0, 0.35, 0.7].forEach((dt, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = i === 2 ? 1046 : 880;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.3);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.32);
    });
  } catch (e) {}
}

export async function fireAlert({ settings, chip, stop, action, sub }) {
  $('#alert-title').textContent = action.includes('轉') ? '轉車提示' : '落車提示';
  $('#alert-chip').textContent = chip || '';
  $('#alert-stop').textContent = stop;
  $('#alert-stop').style.fontSize = stop.length > 8 ? '36px' : stop.length > 4 ? '44px' : '';
  $('#alert-action').textContent = action;
  $('#alert-sub').textContent = sub || '';
  $('#alert').classList.remove('hidden');
  if (settings.vibrate && navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 900]);
  if (settings.sound) beep();
  const body = `下一站 ${stop} · ${action}${sub ? ' · ' + sub : ''}`;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification('搭車易 · 準備落車', { body, tag: 'alight', renotify: true, requireInteraction: true, vibrate: [500, 200, 500] });
      else new Notification('搭車易 · 準備落車', { body, tag: 'alight' });
    } catch (e) {}
  }
}
$('#alert-ok').addEventListener('click', () => $('#alert').classList.add('hidden'));
$('#alert-done').addEventListener('click', () => { $('#alert').classList.add('hidden'); endTrip(); });

/* ---------------- 防熄屏 ---------------- */
async function lockScreen() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (active && document.visibilityState === 'visible') lockScreen();
});

/* ---------------- 行程畫面 ---------------- */
function openTrip({ chip, chipColor, chipText, towards, dest }) {
  $('#trip-chip').textContent = chip;
  $('#trip-chip').style.background = chipColor;
  $('#trip-chip').style.color = chipText || '#fff';
  $('#trip-towards').textContent = towards;
  $('#trip-dest').textContent = dest;
  $('#trip').classList.remove('hidden');
  $('#trip-map').classList.add('hidden');
  lockScreen();
  // 喺用戶撳掣嗰刻開 AudioContext，之後先可以出聲
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) {}
}

function endTrip() {
  if (!active) { $('#trip').classList.add('hidden'); return; }
  clearInterval(active.tick);
  clearInterval(active.poll);
  if (active.watch != null) navigator.geolocation.clearWatch(active.watch);
  active = null;
  try { wakeLock?.release(); } catch (e) {}
  wakeLock = null;
  $('#trip').classList.add('hidden');
}
$('#trip-close').addEventListener('click', endTrip);
$('#trip-end').addEventListener('click', endTrip);
$('#trip-test').addEventListener('click', () => active?.preview());

function renderTimeline(names, nowIdx, notes = {}) {
  $('#trip-stops').innerHTML = names.map((n, i) => {
    const cls = i === names.length - 1 ? 'dest' : i < nowIdx ? 'done' : i === nowIdx ? 'now' : '';
    const note = notes[i] ? `<small>${esc(notes[i])}</small>` : '';
    return `<div class="tl ${cls}"><div class="dot"><i></i></div><div class="name">${esc(n)}${note}</div></div>`;
  }).join('');
}

/* ================= 港鐵行程 =================
   港鐵 API 只有「每個站嘅下幾班車」，冇單一班車由頭行到尾嘅時間。
   做法：開車時間 + 站數 × 每站分鐘 估計到站；再喺落車站嘅班次入面
   搵同一個終點、時間最接近估計嘅一班，用佢嘅到站時間更新。 */
export async function startMtrTrip({ line, from, to, train, settings }) {
  endTrip();
  const L = LINES[line];
  const trip = mtrTrip(line, from, to);
  const seg = trip.forward ? trip.path.slice(trip.a, trip.b + 1) : trip.path.slice(trip.b, trip.a + 1).reverse();
  const names = seg.map(stationName);
  const depart = train.time;
  let arrive = new Date(depart.getTime() + trip.stops * settings.perStop * 60000);
  let refined = false;
  let fired = false;

  openTrip({ chip: L.name, chipColor: L.color, chipText: L.text, towards: `往 ${stationName(train.dest)} · ${train.plat} 號月台`, dest: stationName(to) + '站' });

  const remindAt = () => settings.lead === 'prev'
    ? arrive.getTime() - settings.perStop * 60000
    : arrive.getTime() - Number(settings.lead) * 1000;

  const alertArgs = () => ({ settings, chip: L.name, stop: stationName(to), action: '準備落車', sub: `約 ${hhmm(arrive)} 到站` });

  const tick = () => {
    const now = Date.now();
    const total = arrive - depart;
    const frac = Math.min(1, Math.max(0, (now - depart) / total));
    const idx = now < depart ? 0 : Math.min(seg.length - 1, Math.floor(frac * trip.stops));
    const left = Math.max(0, Math.ceil((arrive - now) / 60000));
    $('#trip-big').textContent = now < depart ? Math.max(0, Math.ceil((depart - now) / 60000)) : left;
    $('#trip-small').textContent = now < depart ? `分鐘後開車 · ${hhmm(depart)}` : `分鐘 · ${hhmm(arrive)} 到`;
    $('#trip-note').textContent = `${trip.stops} 個站 · ` + (refined ? '到站時間按落車站班次更新' : `到站時間按每站 ${settings.perStop} 分鐘估計`);
    renderTimeline(names, idx, now < depart ? { 0: '等緊車' } : { [idx]: idx < seg.length - 1 ? '大約喺呢度' : '' });
    $('#trip-remind').textContent = fired ? '已經提示咗' : `${LEAD_TEXT[settings.lead]}提你（約 ${hhmm(new Date(remindAt()))}）`;
    if (!fired && now >= depart && now >= remindAt()) { fired = true; fireAlert(alertArgs()); }
    if (now > arrive.getTime() + 5 * 60000) endTrip();
  };

  const poll = async () => {
    try {
      const s = await mtrSchedule(line, to);
      const est = depart.getTime() + trip.stops * settings.perStop * 60000;
      const cands = [...s.up, ...s.down]
        .filter(t => t.dest === train.dest && Math.abs(t.time - est) <= 4 * 60000);
      if (cands.length) {
        cands.sort((a, b) => Math.abs(a.time - est) - Math.abs(b.time - est));
        arrive = cands[0].time;
        refined = true;
      }
    } catch (e) {}
  };

  active = { tick: setInterval(tick, 1000), poll: setInterval(poll, 20000), watch: null, preview: () => fireAlert(alertArgs()) };
  tick();
  poll();
}

/* ================= 巴士 / 小巴行程 =================
   用 GPS：距離落車站少過設定距離（或者到咗前一站）就提示。 */
const dist = (a, b) => {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export async function startBusTrip({ dir, stops, board, alight, settings }) {
  endTrip();
  const seg = stops.slice(board, alight + 1);
  const target = seg[seg.length - 1];
  const prev = seg[seg.length - 2];
  const hasCoords = seg.every(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  let fired = false;
  let nowIdx = 0;

  openTrip({ chip: `${CO_NAME[dir.co]} ${dir.route}`, chipColor: CO_COLOR[dir.co], towards: dir.label, dest: target.name });
  renderTimeline(seg.map(s => s.name), 0, { 0: '上車站' });
  $('#trip-big').textContent = seg.length - 1;
  $('#trip-small').textContent = '個站';
  $('#trip-remind').textContent = settings.lead === 'prev'
    ? `到 ${prev.name} 時提你`
    : `離 ${target.name} 大約 ${LEAD_METERS[settings.lead]} 米（${LEAD_TEXT[settings.lead]}）提你`;

  const alertArgs = () => ({ settings, chip: `${CO_NAME[dir.co]} ${dir.route}`, stop: target.name, action: '準備落車', sub: '記得撳鐘' });
  active = { tick: null, poll: null, watch: null, preview: () => fireAlert(alertArgs()) };

  // 上車前顯示下一班車幾耐到
  const etaPoll = async () => {
    if (!active || nowIdx > 0) return;
    try {
      const etas = (await dir.eta(seg[0])).filter(x => x.time);
      if (etas.length && nowIdx === 0) $('#trip-note').textContent = `下一班喺 ${seg[0].name}：${Math.max(0, Math.round((etas[0].time - Date.now()) / 60000))} 分鐘`;
    } catch (e) {}
  };
  etaPoll();
  active.poll = setInterval(etaPoll, 30000);

  if (!hasCoords || !navigator.geolocation) {
    $('#trip-note').textContent = '呢條路線有啲車站冇座標，或者部機冇定位功能，所以唔能夠自動提示。';
    return;
  }

  drawMap(seg);

  active.watch = navigator.geolocation.watchPosition(pos => {
    if (!active) return;
    const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    // 最近嘅車站 = 大約去到邊
    let best = 0, bestD = Infinity;
    seg.forEach((s, i) => { const d = dist(me, s); if (d < bestD) { bestD = d; best = i; } });
    nowIdx = Math.max(nowIdx, best);
    const dTarget = dist(me, target);
    const left = Math.max(0, seg.length - 1 - nowIdx);
    $('#trip-big').textContent = left;
    $('#trip-small').textContent = `個站 · 離落車站 ${dTarget >= 1000 ? (dTarget / 1000).toFixed(1) + ' 公里' : Math.round(dTarget) + ' 米'}`;
    const speed = pos.coords.speed;
    $('#trip-note').textContent = speed && speed > 2
      ? `車速約 ${Math.round(speed * 3.6)} 公里/小時 · 估計 ${Math.max(1, Math.round(dTarget / speed / 60))} 分鐘到`
      : `定位準確度約 ${Math.round(pos.coords.accuracy)} 米`;
    renderTimeline(seg.map(s => s.name), nowIdx, { [nowIdx]: nowIdx < seg.length - 1 ? '大約喺呢度' : '' });
    updateMe(me);

    const near = settings.lead === 'prev'
      ? (dist(me, prev) < 120 || nowIdx >= seg.length - 1 || dTarget < dist(prev, target) * 0.6)
      : dTarget <= LEAD_METERS[settings.lead];
    if (!fired && near && nowIdx > 0) {
      fired = true;
      $('#trip-remind').textContent = '已經提示咗';
      fireAlert(alertArgs());
    }
  }, err => {
    $('#trip-note').textContent = err.code === 1 ? '冇定位權限，請喺瀏覽器設定允許「位置」。' : '暫時攞唔到定位。';
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

/* ---------------- 地圖（Leaflet + OpenStreetMap） ---------------- */
let meMarker = null;
function drawMap(seg) {
  if (!window.L) return;
  const el = $('#trip-map');
  el.classList.remove('hidden');
  if (!map) {
    map = L.map(el, { zoomControl: false, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(map);
  }
  mapLayers.forEach(l => l.remove());
  mapLayers = [];
  meMarker = null;
  const pts = seg.map(s => [s.lat, s.lng]);
  mapLayers.push(L.polyline(pts, { color: '#C2410C', weight: 5 }).addTo(map));
  seg.forEach((s, i) => {
    const last = i === seg.length - 1;
    mapLayers.push(L.circleMarker([s.lat, s.lng], {
      radius: last || i === 0 ? 8 : 5, color: '#15171C', weight: 2,
      fillColor: last ? '#C2410C' : '#FFFFFF', fillOpacity: 1
    }).bindTooltip(s.name).addTo(map));
  });
  setTimeout(() => { map.invalidateSize(); map.fitBounds(pts, { padding: [24, 24] }); }, 50);
}
function updateMe(me) {
  if (!map || !window.L) return;
  if (!meMarker) {
    meMarker = L.circleMarker([me.lat, me.lng], { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1F4E8C', fillOpacity: 1 }).addTo(map);
    mapLayers.push(meMarker);
  } else meMarker.setLatLng([me.lat, me.lng]);
}
