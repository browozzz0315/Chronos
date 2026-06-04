# Chronos — LLM 協作文件

> 本文件專為 LLM（OpenAI / Groq 等）提供專案背景與協作脈絡。
> 每次對話開始前請先閱讀此文件，以了解現況與規範。

---

## 一、專案概述

**名稱**：Chronos
**類型**：AI 輔助加密貨幣研究與策略驗證平台（Side Project）
**目的**：建立「可記錄、可驗證、可持續優化」的系統化看盤流程，非自動交易機器人。

### 核心理念

- 不預測價格，而是**驗證策略是否有統計優勢**
- 所有訊號需記錄「觸發當下的完整指標快照」，事後才能有意義地驗證
- 市場狀態分類（趨勢盤 vs 震盪盤）是驗證的前提，否則勝率統計無效
- MVP 嚴格控制範圍，不做真實下單、不做複雜 ML

---

## 二、目前開發進度（截至 2026-06-03）

### ✅ 已完成

| Step | 模組 | 說明 |
|---|---|---|
| 6 | `binanceService.js` | 抓取多時間框架 K 線（1h/4h/1d），300 根，OHLCV 全部轉 Float |
| 7 | `indicatorService.js` | EMA20/50/200、RSI14、MACD、ATR14、ADX14、Bollinger Bands、市場狀態分類 |
| 8 | `signalService.js` | 三個規則型策略：TREND_LONG / TREND_SHORT / OVERSOLD_BOUNCE |
| 9 | `verifyService.js` | 延遲驗證：SL=1.5ATR、TP1/2/3=1.5/3/4.5ATR，計算 R 倍數、MFE、MAE |
| 10 | `dashboardServer.js` + `index.html` | 純 Node http 伺服器，提供 API；HTML Dashboard 顯示圖表與訊號績效 |
| 11 | `cronJob.js` + `pipelineService.js` | 每小時自動執行抓資料、計算指標、產生訊號、延遲驗證與存檔 |
| 11.5 | `signalService.js` | 訊號品質控管：trend transition filter + cooldown，避免同一段趨勢重複出訊號 |
| 12 | `symbols.js` + pipeline/API | 多幣種支援 BTCUSDT / ETHUSDT / DOGEUSDT，資料檔採 `{symbol.toLowerCase()}_{tf}.json` |

### ⏳ 尚未完成

| Step | 內容 | 優先順序 |
|---|---|---|
| 13 | LLM 整合 — 訊號解釋 / 每日報告 | 🟡 中 |
| 14 | PostgreSQL 取代 JSON | 🟢 低（MVP 後期） |

---

## 三、專案目錄結構

```
chronos/
├── backend/
│   ├── public/
│   │   └── index.html              # Dashboard 前端
│   └── src/
│       ├── scripts/
│       │   ├── fetchBTC.js         # 抓資料 + 計算指標 + 存檔
│       │   ├── testSignals.js      # 驗證訊號邏輯（本地，不需網路）
│       │   ├── runVerification.js  # 執行延遲驗證，存 {symbol}_1h_verified.json
│       │   ├── dashboardServer.js  # HTTP API Server（port 3001）
│       │   └── cronJob.js          # 定時執行多幣種 pipeline
│       ├── services/
│       │   ├── binanceService.js   # Binance API 封裝（fetchKlines, fetchMultiTimeframe）
│       │   ├── indicatorService.js # 技術指標計算（純手寫，無外部依賴）
│       │   ├── signalService.js    # 規則型訊號產生器
│       │   ├── verifyService.js    # 延遲驗證邏輯（calcLevels, verifySignal, summarize）
│       │   └── pipelineService.js  # fetch → indicators → signals → verify → saveJson
│       └── utils/
│           ├── saveJson.js         # JSON 存檔工具（路徑：../../../data）
│           └── symbols.js          # 多幣種清單、symbol 正規化、資料檔命名工具
├── data/
│   ├── btcusdt_1h.json             # BTCUSDT 300 根 1h K 線 + 指標
│   ├── btcusdt_4h.json             # BTCUSDT 200 根 4h K 線 + 指標
│   ├── btcusdt_1d.json             # BTCUSDT 200 根 1d K 線 + 指標
│   ├── btcusdt_1h_verified.json    # BTCUSDT 驗證結果（含 R 倍數、MFE、MAE）
│   ├── ethusdt_*.json              # ETHUSDT 多時間框架與驗證結果
│   ├── dogeusdt_*.json             # DOGEUSDT 多時間框架與驗證結果
│   └── btc_*.json                  # 舊 BTC 檔名 fallback，保留過渡用
├── docs/
├── llm.md                          # 本文件
└── README.md                       # 使用者說明
```

---

## 四、關鍵設計決策與原因

### 1. 為什麼不用外部套件計算指標？
`indicatorService.js` 全部純手寫（EMA、RSI、MACD、ATR、ADX、BB）。
原因：方便理解邏輯、無版本依賴問題、適合未來移植到其他語言。

### 2. 為什麼 SL/TP 用 ATR 倍數而非固定點數？
不同幣種波動率差距大（BTC ATR ≈ 500，DOGE ATR ≈ 0.003）。
用 ATR 倍數才能讓跨幣種的 R 倍數具有可比性。
- SL = 1.5 × ATR14
- TP1 = 1.5 × ATR（RR 1:1）
- TP2 = 3.0 × ATR（RR 1:2）
- TP3 = 4.5 × ATR（RR 1:3）

### 3. 為什麼市場狀態分類這麼重要？
同一個 RSI 超賣訊號，在趨勢盤（ADX > 25）和震盪盤（ADX < 20）的行為完全不同。
混在一起統計勝率是無效資料。`classifyMarketState()` 在每根 K 線上標記狀態，驗證時一併記錄。

### 4. 為什麼 MVP 用規則型訊號而非 ML？
資料累積不足（< 500 筆）時，監督式 ML 會過擬合。
先用規則型訊號累積標記資料，等 3-6 個月後再引入 XGBoost / Random Forest。

### 5. 路徑規範
所有 scripts 在 `backend/src/scripts/`，往上三層才是根目錄。
- 讀寫 data/：`path.join(__dirname, "../../../data", filename)`
- 引用 services：`require("../services/serviceName")`
- 引用 utils：`require("../utils/utilName")`

### 6. 為什麼加入訊號品質控管？
原本趨勢條件連續成立時，每根 K 都會產生同方向訊號，導致樣本高度重複、績效統計失真。
目前 `generateSignals()` 加入兩層控管：
- `cooldownBars = 6`：同策略同方向至少間隔 6 根 K 才能再次出訊號
- `requireTrendTransition = true`：TREND_LONG / TREND_SHORT 只在條件剛從不成立變成立時進場

---

## 五、訊號策略說明

### TREND_LONG（趨勢順勢做多）
```
條件：
  EMA20 > EMA50 > EMA200（多頭排列）
  RSI 在 45~65（動能健康，不追高）
  收盤 > EMA20（在均線上方）
  MACD Histogram > 0（動能向上）
  ADX >= 20（有趨勢）
```

### TREND_SHORT（趨勢順勢做空）
```
條件：
  EMA20 < EMA50 < EMA200（空頭排列）
  RSI 在 35~55
  收盤 < EMA20
  MACD Histogram < 0
  ADX >= 20
```

### OVERSOLD_BOUNCE（超賣反彈做多）
```
條件：
  RSI < 30（超賣）
  成交量 > 20期均量 × 1.3（量能放大）
  收盤 > EMA200（大趨勢仍偏多）
  前一根為陰線（在跌勢中超賣）
```

### 訊號品質控管
```
預設：
  cooldownBars = 6
  requireTrendTransition = true

行為：
  同策略同方向訊號至少間隔 6 根 K
  TREND_LONG / TREND_SHORT 只在條件剛成立時觸發
  signal.quality 會記錄 cooldownBars、barsSinceLastSignal、transitionEntry
```

---

## 六、驗證系統輸出格式

每筆驗證後的訊號結構：
```json
{
  "id": "TREND_SHORT_1748527200000",
  "openTime": 1748527200000,
  "symbol": "BTCUSDT",
  "entryPrice": 75274.58,
  "strategy": "TREND_SHORT",
  "direction": "SHORT",
  "conditions": { "ema_alignment": true, ... },
  "snapshot": { "close": 75274.58, "rsi14": 42.1, ... },
  "quality": {
    "cooldownBars": 6,
    "barsSinceLastSignal": 9,
    "transitionEntry": true
  },
  "verification": {
    "outcome": "WIN_TP3",
    "exitPrice": 73514.8,
    "exitReason": "TP3",
    "exitBar": 7,
    "rMultiple": 3.0,
    "pnlPct": 2.338,
    "tp1Hit": true,
    "tp2Hit": true,
    "tp3Hit": true,
    "slHit": false,
    "mfe": 2213.99,
    "mae": 0,
    "levels": { "sl": 75861.17, "tp1": 74687.99, "tp2": 74101.39, "tp3": 73514.8, "slDist": 586.59 }
  }
}
```

---

## 七、Dashboard API

伺服器：`node src/scripts/dashboardServer.js`（port 3001，無需安裝 express）

| Endpoint | 說明 |
|---|---|
| `GET /api/signals` | `btc_1h_verified.json` 全部訊號 |
| `GET /api/klines` | `btc_1h.json`（只回傳 EMA200 有值的部分） |
| `GET /api/summary` | 各策略勝率、平均 R 統計 |

---

## 八、目前樣本統計（2026-06-03）

| 幣種 | 策略 | 樣本數 | 勝率 | 平均 R |
|---|---|---|---|---|
| BTCUSDT | TREND_SHORT | 4 | 25% | 0 |
| ETHUSDT | TREND_SHORT | 6 | 66.7% | +0.519 |
| DOGEUSDT | — | 0 | — | — |

⚠️ 樣本仍然過少，統計只能用來檢查流程是否正常，不能視為策略穩定結論。需累積 50+ 筆以上才比較有參考價值。
目前 BTC / ETH 主要觸發 TREND_SHORT，DOGEUSDT 資料完整但尚未觸發訊號。

---

## 九、LLM 協作時的注意事項

1. **路徑寫法**：scripts 往上三層是根目錄（`../../../`），不是四層
2. **指標 null 處理**：用 `== null`（同時涵蓋 undefined），不要用 `=== null`
3. **資料型別**：Binance API 回傳 OHLCV 是 String，存檔前必須 `parseFloat()`
4. **EMA200 需要 200 根暖機**：抓資料時 limit 設 300（1h）才有足夠的有效根數
5. **新增幣種**：已支援 `BTCUSDT`、`ETHUSDT`、`DOGEUSDT`；新增幣種時請透過 `symbols.js` / `CHRONOS_SYMBOLS` 管理，避免重新硬寫
6. **不要修改 data/ 下的 JSON**：這些是系統運行產出，應由腳本管理，不手動編輯

---

## 十、下一步待辦（LLM 協作用）

### Step 11（已完成）
**自動定時抓資料（Cron Job）**
- 套件：`node-cron`
- 頻率：每小時一次（`0 * * * *`）
- 動作：fetchMultiTimeframe → calcAllIndicators → generateSignals → verifyAll → saveJson
- 入口：`src/scripts/cronJob.js`
- Pipeline：`src/services/pipelineService.js`

### Step 11.5（已完成）
**訊號品質控管**
- 趨勢策略只在條件剛成立時觸發
- 同策略同方向預設 `cooldownBars = 6`
- signal 新增 `quality` 欄位，記錄 cooldown 與 barsSinceLastSignal

### Step 12（已完成）
**多幣種擴展**
- 將 symbol 從硬寫改為參數
- 支援：BTCUSDT、ETHUSDT、DOGEUSDT
- 資料檔命名規則：`{symbol.toLowerCase()}_{tf}.json`
- 新增：`src/utils/symbols.js`
- Dashboard API 支援 `?symbol=BTCUSDT`
- BTC 舊檔 `btc_*.json` 保留 fallback，方便過渡

### Step 13（下一個要做的）
**LLM 整合**
- 每個訊號觸發時呼叫 OpenAI API 或 Groq API 生成自然語言解釋
- 每日生成策略績效報告

補充：
- `ChatGPT Plus` 與 `OpenAI API` 分開計費，不能直接把 Plus 訂閱當作 API 使用
- OpenAI 請使用 `OPENAI_API_KEY`
- Groq 請使用 `GROQ_API_KEY`
- Provider 可用 `CHRONOS_LLM_PROVIDER=openai` 或 `groq` 切換；不設定時自動依可用金鑰判斷

### Step 14
**PostgreSQL 遷移**
- 替換 JSON 存檔
- 支援複雜查詢（跨幣種、跨時間框架統計）
