// 香港政府開放數據 API（DATA.GOV.HK）
// 港鐵：rt.data.gov.hk  九巴：data.etabus.gov.hk  城巴：rt.data.gov.hk/v2  綠色小巴：data.etagmb.gov.hk

const MTR = 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php';
const KMB = 'https://data.etabus.gov.hk/v1/transport/kmb';
const CTB = 'https://rt.data.gov.hk/v2/transport/citybus';
const GMB = 'https://data.etagmb.gov.hk';

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// 有記憶嘅 fetch：路線、車站名呢類唔常變嘅資料存喺 localStorage 一日
const memo = new Map();
async function cached(url, ttlMs = 24 * 3600 * 1000) {
  if (memo.has(url)) return memo.get(url);
  const key = 'c:' + url;
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null');
    if (hit && Date.now() - hit.t < ttlMs) { memo.set(url, hit.v); return hit.v; }
  } catch (e) { /* 冇 localStorage 都照行 */ }
  const p = getJSON(url).then(v => {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch (e) {}
    return v;
  });
  memo.set(url, p);
  p.catch(() => memo.delete(url));
  return p;
}

const hkTime = s => new Date(s.replace(' ', 'T') + '+08:00');

/* ---------------- 港鐵 ---------------- */
export async function mtrSchedule(line, sta) {
  const r = await getJSON(`${MTR}?line=${line}&sta=${sta}`);
  if (r.status === 0) throw new Error(r.message || '港鐵數據暫時唔提供');
  const d = (r.data || {})[`${line}-${sta}`] || {};
  const norm = arr => (arr || [])
    .filter(t => t.valid !== 'N')
    .map(t => ({ dest: t.dest, plat: t.plat, time: hkTime(t.time), ttnt: Number(t.ttnt) }));
  return { up: norm(d.UP), down: norm(d.DOWN), delay: r.isdelay === 'Y' };
}

/* ---------------- 巴士 / 小巴：統一格式 ----------------
   searchRoute(co, route) → [{ key, label, sub, co, route, loadStops(), eta(stop) }]
   stop = { id, seq, name, lat, lng }
   eta → [{ time: Date|null, rmk }]
*/
export async function searchRoute(co, route) {
  route = route.trim().toUpperCase();
  if (!route) return [];
  if (co === 'KMB') return kmbDirections(route);
  if (co === 'CTB') return ctbDirections(route);
  if (co === 'GMB') return gmbDirections(route);
  return [];
}

/* 九巴 */
async function kmbDirections(route) {
  const all = await cached(`${KMB}/route/`);
  return (all.data || [])
    .filter(r => r.route === route)
    .map(r => {
      const bound = r.bound === 'O' ? 'outbound' : 'inbound';
      const st = r.service_type;
      return {
        key: `KMB|${route}|${r.bound}|${st}`,
        co: 'KMB', route,
        label: `往 ${r.dest_tc}`,
        sub: `由 ${r.orig_tc}` + (st !== '1' ? ' · 特別班次' : ''),
        loadStops: async () => {
          const rs = await cached(`${KMB}/route-stop/${route}/${bound}/${st}`);
          const list = (rs.data || []).sort((a, b) => a.seq - b.seq);
          return Promise.all(list.map(async x => {
            const s = (await cached(`${KMB}/stop/${x.stop}`)).data;
            return { id: x.stop, seq: Number(x.seq), name: s.name_tc, lat: +s.lat, lng: +s.long };
          }));
        },
        eta: async stop => {
          const r2 = await getJSON(`${KMB}/eta/${stop.id}/${route}/${st}`);
          return (r2.data || [])
            .filter(e => e.dir === r.bound && Number(e.seq) === stop.seq)
            .map(e => ({ time: e.eta ? new Date(e.eta) : null, rmk: e.rmk_tc || '' }));
        }
      };
    });
}

/* 城巴 */
async function ctbDirections(route) {
  const info = (await cached(`${CTB}/route/CTB/${route}`)).data;
  if (!info || !info.route) return [];
  const mk = (dir, label, sub, code) => ({
    key: `CTB|${route}|${code}`,
    co: 'CTB', route, label, sub,
    loadStops: async () => {
      const rs = await cached(`${CTB}/route-stop/CTB/${route}/${dir}`);
      const list = (rs.data || []).sort((a, b) => a.seq - b.seq);
      return Promise.all(list.map(async x => {
        const s = (await cached(`${CTB}/stop/${x.stop}`)).data;
        return { id: x.stop, seq: Number(x.seq), name: s.name_tc, lat: +s.lat, lng: +s.long };
      }));
    },
    eta: async stop => {
      const r2 = await getJSON(`${CTB}/eta/CTB/${stop.id}/${route}`);
      return (r2.data || [])
        .filter(e => e.dir === code && Number(e.seq) === stop.seq)
        .map(e => ({ time: e.eta ? new Date(e.eta) : null, rmk: e.rmk_tc || '' }));
    }
  });
  return [
    mk('outbound', `往 ${info.dest_tc}`, `由 ${info.orig_tc}`, 'O'),
    mk('inbound', `往 ${info.orig_tc}`, `由 ${info.dest_tc}`, 'I')
  ];
}

/* 綠色專線小巴 */
async function gmbDirections(route) {
  const out = [];
  for (const region of ['HKI', 'KLN', 'NT']) {
    let res;
    try { res = await cached(`${GMB}/route/${region}/${encodeURIComponent(route)}`); } catch (e) { continue; }
    for (const v of (res.data || [])) {
      for (const d of (v.directions || [])) {
        const rid = v.route_id, rseq = d.route_seq;
        const regionName = { HKI: '港島', KLN: '九龍', NT: '新界' }[region];
        out.push({
          key: `GMB|${rid}|${rseq}`,
          co: 'GMB', route,
          label: `往 ${d.dest_tc}`,
          sub: `${regionName} · 由 ${d.orig_tc}` + (v.description_tc && v.description_tc !== '正常班次' ? ` · ${v.description_tc}` : ''),
          loadStops: async () => {
            const rs = await cached(`${GMB}/route-stop/${rid}/${rseq}`);
            const list = ((rs.data || {}).route_stops || []).sort((a, b) => a.stop_seq - b.stop_seq);
            return Promise.all(list.map(async x => {
              let lat = NaN, lng = NaN;
              try {
                const s = (await cached(`${GMB}/stop/${x.stop_id}`)).data;
                lat = s.coordinates.wgs84.latitude; lng = s.coordinates.wgs84.longitude;
              } catch (e) {}
              return { id: x.stop_id, seq: x.stop_seq, name: x.name_tc, lat, lng };
            }));
          },
          eta: async stop => {
            const r2 = await getJSON(`${GMB}/eta/route-stop/${rid}/${rseq}/${stop.seq}`);
            const d2 = r2.data || {};
            if (d2.enabled === false) return [];
            return (d2.eta || []).map(e => ({ time: e.timestamp ? new Date(e.timestamp) : null, rmk: e.remarks_tc || '' }));
          }
        });
      }
    }
  }
  return out;
}

export const CO_NAME = { KMB: '九巴', CTB: '城巴', GMB: '小巴' };
export const CO_COLOR = { KMB: '#C8102E', CTB: '#1F4E8C', GMB: '#1E6B3F' };
