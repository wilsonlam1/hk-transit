// 港鐵綫路同車站（用於「港鐵到站時間」API）
// paths：每條綫由一端行到另一端嘅車站次序；有分支嘅綫（將軍澳綫、東鐵綫）有兩條 path。
export const STATIONS = {
  // 港島 / 南港島
  KET: '堅尼地城', HKU: '香港大學', SYP: '西營盤', SHW: '上環', CEN: '中環', ADM: '金鐘',
  WAC: '灣仔', CAB: '銅鑼灣', TIH: '天后', FOH: '炮台山', NOP: '北角', QUB: '鰂魚涌',
  TAK: '太古', SWH: '西灣河', SKW: '筲箕灣', HFC: '杏花邨', CHW: '柴灣',
  OCP: '海洋公園', WCH: '黃竹坑', LET: '利東', SOH: '海怡半島',
  HOK: '香港', EXC: '會展',
  // 九龍
  TST: '尖沙咀', JOR: '佐敦', YMT: '油麻地', MOK: '旺角', PRE: '太子', SSP: '深水埗',
  CSW: '長沙灣', LCK: '荔枝角', MEF: '美孚', WHA: '黃埔', HOM: '何文田', SKM: '石硤尾',
  KOT: '九龍塘', LOF: '樂富', WTS: '黃大仙', DIH: '鑽石山', CHH: '彩虹', KOB: '九龍灣',
  NTK: '牛頭角', KWT: '觀塘', LAT: '藍田', YAT: '油塘', KOW: '九龍', OLY: '奧運',
  NAC: '南昌', AUS: '柯士甸', ETS: '尖東', HUH: '紅磡', MKK: '旺角東', KAT: '啟德',
  SUW: '宋皇臺', TKW: '土瓜灣',
  // 新界
  LAK: '荔景', KWF: '葵芳', KWH: '葵興', TWH: '大窩口', TSW: '荃灣', TWW: '荃灣西',
  TSY: '青衣', SUN: '欣澳', TUC: '東涌', AIR: '機場', AWE: '博覽館',
  TIK: '調景嶺', TKO: '將軍澳', LHP: '康城', HAH: '坑口', POA: '寶琳',
  TAW: '大圍', SHT: '沙田', FOT: '火炭', RAC: '馬場', UNI: '大學', TAP: '大埔墟',
  TWO: '太和', FAN: '粉嶺', SHS: '上水', LOW: '羅湖', LMC: '落馬洲',
  WKS: '烏溪沙', MOS: '馬鞍山', HEO: '恒安', TSH: '大水坑', SHM: '石門', CIO: '第一城',
  STW: '沙田圍', CKT: '車公廟', HIK: '顯徑', KSR: '錦上路', YUL: '元朗', LOP: '朗屏',
  TIS: '天水圍', SIH: '兆康', TUM: '屯門'
};

export const LINES = {
  TML: { name: '屯馬綫', color: '#9A3B26', text: '#FFFFFF', paths: [[
    'WKS','MOS','HEO','TSH','SHM','CIO','STW','CKT','TAW','HIK','DIH','KAT','SUW','TKW',
    'HOM','HUH','ETS','AUS','NAC','MEF','TWW','KSR','YUL','LOP','TIS','SIH','TUM']] },
  TWL: { name: '荃灣綫', color: '#E2231A', text: '#FFFFFF', paths: [[
    'CEN','ADM','TST','JOR','YMT','MOK','PRE','SSP','CSW','LCK','MEF','LAK','KWF','KWH','TWH','TSW']] },
  ISL: { name: '港島綫', color: '#0075C2', text: '#FFFFFF', paths: [[
    'KET','HKU','SYP','SHW','CEN','ADM','WAC','CAB','TIH','FOH','NOP','QUB','TAK','SWH','SKW','HFC','CHW']] },
  KTL: { name: '觀塘綫', color: '#00A040', text: '#FFFFFF', paths: [[
    'WHA','HOM','YMT','MOK','PRE','SKM','KOT','LOF','WTS','DIH','CHH','KOB','NTK','KWT','LAT','YAT','TIK']] },
  TKL: { name: '將軍澳綫', color: '#7D499D', text: '#FFFFFF', paths: [
    ['NOP','QUB','YAT','TIK','TKO','HAH','POA'],
    ['NOP','QUB','YAT','TIK','TKO','LHP']] },
  EAL: { name: '東鐵綫', color: '#5EB6E4', text: '#15171C', paths: [
    ['ADM','EXC','HUH','MKK','KOT','TAW','SHT','FOT','RAC','UNI','TAP','TWO','FAN','SHS','LOW'],
    ['ADM','EXC','HUH','MKK','KOT','TAW','SHT','FOT','UNI','TAP','TWO','FAN','SHS','LMC']] },
  TCL: { name: '東涌綫', color: '#F7943E', text: '#15171C', paths: [[
    'HOK','KOW','OLY','NAC','LAK','TSY','SUN','TUC']] },
  AEL: { name: '機場快綫', color: '#00888A', text: '#FFFFFF', paths: [[
    'HOK','KOW','TSY','AIR','AWE']] },
  SIL: { name: '南港島綫', color: '#CBD300', text: '#15171C', paths: [[
    'ADM','OCP','WCH','LET','SOH']] }
};

// 一條綫上面所有車站（唔重複，按 path 次序）
export function lineStations(line) {
  const seen = new Set();
  const out = [];
  for (const p of LINES[line].paths) for (const s of p) if (!seen.has(s)) { seen.add(s); out.push(s); }
  return out;
}

// 由 from 去 to：搵包含兩個站嘅 path，計站數同方向
export function mtrTrip(line, from, to) {
  for (const p of LINES[line].paths) {
    const a = p.indexOf(from), b = p.indexOf(to);
    if (a !== -1 && b !== -1 && a !== b) {
      return { path: p, a, b, stops: Math.abs(b - a), forward: b > a };
    }
  }
  return null;
}

// 判斷一班車（終點站 dest）係咪會經過 to
export function trainServes(line, from, to, dest) {
  for (const p of LINES[line].paths) {
    const a = p.indexOf(from), b = p.indexOf(to), d = p.indexOf(dest);
    if (a === -1 || b === -1 || d === -1) continue;
    if (b > a && d >= b) return true;
    if (b < a && d <= b) return true;
  }
  return false;
}

export const stationName = code => STATIONS[code] || code;
