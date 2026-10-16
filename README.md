# 搭車易（試用版）

香港搭車小工具：睇港鐵、九巴、城巴、綠色小巴實時到站時間，坐車時到站前提你落車。
純網頁（HTML + JavaScript），唔使伺服器，可以直接放上 GitHub Pages 免費用。

## 功能

- **港鐵**：揀綫路、上車站、落車站 → 顯示往呢個方向嘅下幾班車（每 15 秒更新）。撳「搭呢班」開始行程。
- **巴士 / 小巴**：九巴、城巴、綠色專線小巴。輸入路線 → 揀方向 → 撳車站睇到站時間 → 揀上車站同落車站 → 開始行程。
- **落車提示**：到站前 30 秒 / 1 分鐘 / 2 分鐘 / 前一站提你，有震動、響聲同通知。
- **地圖**：巴士 / 小巴行程會顯示路線同你而家喺邊（OpenStreetMap）。
- **收藏**：收藏常用港鐵行程同巴士行程（存喺手機瀏覽器）。
- **設定**：預設提示時間、震動、響聲、港鐵每站分鐘。

## 放上 GitHub（唔使識 git）

1. 登入 [github.com](https://github.com)，右上角 **+** → **New repository**。
   名叫 `hk-transit`，揀 **Public**，撳 **Create repository**。
2. 喺新 repo 頁撳 **uploading an existing file**，將呢個資料夾入面**所有檔案同 `js` 資料夾**拖入去，
   再撳 **Commit changes**。
3. 去 **Settings → Pages**：Source 揀 **Deploy from a branch**，Branch 揀 **main**、資料夾 **/(root)**，撳 **Save**。
4. 等 1–2 分鐘，網址會係 `https://<你嘅 GitHub 名>.github.io/hk-transit/`。
5. 用手機開呢個網址：
   - **iPhone**：Safari → 分享 → **加入主畫面**（要咁做先收到通知）。
   - **Android**：Chrome → ⋮ → **安裝應用程式 / 加到主畫面**。
6. 第一次用：去「設定」撳 **開啟通知權限** 同 **測試落車提示**。開始巴士行程時要允許「位置」。

改咗檔案之後再上傳一次就會更新（手機可能要關咗 App 再開）。

## 落車提示點運作

| 交通工具 | 方法 | 準確度 |
| --- | --- | --- |
| 港鐵 | 開車時間 + 站數 × 每站分鐘估計，再用落車站嘅班次校正 | 一般相差 1 分鐘內；隧道冇 GPS，所以唔用定位 |
| 巴士 / 小巴 | 手機 GPS 計同落車站嘅距離（30 秒 ≈ 250 米、1 分鐘 ≈ 500 米、2 分鐘 ≈ 1 公里） | 受塞車同 GPS 影響，「前一站」通常最穩陣 |

## 試用版限制

- **行程中要保持畫面開住**：網頁喺背景會被手機暫停，所以 App 會自動防止熄屏。真 App 先可以喺背景同鎖機時提示。
- 未有轉車路線規劃（要 Google Directions 或者自建規劃引擎，留返真 App 做）。
- 港鐵只支援同一條綫上面嘅行程；輕鐵、電車、渡輪未有。
- 九巴路線表第一次載入會慢少少，之後會記住一日。

## 數據來源

DATA.GOV.HK 開放數據：

- 港鐵列車到站時間 `rt.data.gov.hk/v1/transport/mtr/getSchedule.php`
- 九巴 `data.etabus.gov.hk/v1/transport/kmb`
- 城巴 `rt.data.gov.hk/v2/transport/citybus`
- 綠色專線小巴 `data.etagmb.gov.hk`

地圖：© OpenStreetMap 貢獻者，Leaflet。

## 檔案

```
index.html            畫面
style.css             樣式（支援深色模式）
js/app.js             港鐵、巴士、收藏、設定
js/trip.js            行程中、落車提示、地圖
js/api.js             開放數據 API
js/mtr-data.js        港鐵綫路同車站
sw.js                 離線快取同通知
manifest.webmanifest  加入主畫面用
icon.svg              圖示
```
