# ⚡ Chronos

> AI 輔助加密貨幣研究與策略驗證平台

Chronos 是一個小型研究型 Side Project，目標是建立一套「可記錄、可驗證、可持續優化」的系統化看盤流程。

**這不是自動交易機器人。** 核心價值在於：把每一個交易判斷記錄下來，事後驗證它是否真的有統計優勢。

---

## 功能概覽

- **自動抓取** Binance K 線資料（1h / 4h / 1d，支援多幣種）
- **計算技術指標**：EMA20/50/200、RSI14、MACD、ATR、ADX、Bollinger Bands
- **市場狀態分類**：趨勢盤 / 震盪盤 / 高低波動，確保策略在正確環境下統計
- **規則型訊號產生**：三個策略（趨勢順勢做多/空、超賣反彈）
- **觀察型方向預測**：每根 1H 收盤 K 產生 OBS_BIAS_LONG / OBS_BIAS_SHORT，累積看盤輔助樣本
- **延遲驗證系統**：自動計算每筆訊號的 R 倍數、MFE、MAE、出場原因
- **LLM 解釋與報告**：支援 OpenAI / Groq，為訊號生成自然語言解釋與每日報告
- **Dashboard**：視覺化策略績效、訊號列表、K 線圖

---

## 快速開始

### 環境需求

- Node.js >= 18
- 網路連線（Binance 公開 API，無需 API Key）

### 安裝

```bash
git clone <repo-url>
cd chronos/backend
npm install
```

### 執行流程

```bash
# 1. 單次執行完整 pipeline（BTC / ETH / SOL）
npm run pipeline

# 2. 只針對單一幣種執行延遲驗證
npm run verify -- BTCUSDT

# 3. 啟動 Dashboard
npm run dashboard
# → 開啟瀏覽器：http://localhost:3001

# 4. 本地 cron，每小時第 2 分鐘自動跑 pipeline
npm run cron

# 驗證訊號邏輯（不需網路，讀本地資料）
npm run test:signals -- BTCUSDT

# Step 13：啟用 LLM 訊號解釋（可選）
# ChatGPT Plus 不能直接當 API key，需另外準備 OPENAI_API_KEY
$env:OPENAI_API_KEY="your_api_key"
npm run pipeline

# 或改用 Groq
$env:GROQ_API_KEY="your_groq_api_key"
$env:CHRONOS_LLM_PROVIDER="groq"
npm run report:daily
```

LLM 用量控制：
- Groq 預設模型為 `llama-3.3-70b-versatile`；若你曾設定 `GROQ_MODEL=openai/gpt-oss-20b`，建議先移除或改回 Llama 3.3
- 預設只對 `signalType=TRADE` 的正式策略訊號產生少量解釋，避免 OBS 訊號大量觸發 429
- 預設採用 batch 模式，一次把選出的訊號打包送給 LLM，再依 signal id 寫回 JSON：`CHRONOS_LLM_BATCH_EXPLANATIONS=true`
- 預設每次每個幣種最多產生 5 筆訊號解釋：`CHRONOS_LLM_MAX_EXPLANATIONS_PER_RUN=5`
- OBS 訊號會以批次統計、近期樣本、代表性樣本納入每日報告分析，不會每筆各打一個 API call
- 可用 `CHRONOS_LLM_EXPLAIN_SIGNALS=all` 改成全部訊號，但不建議在 OBS 樣本很多時使用
- 只更新單一幣種可用：`npm run pipeline -- BTCUSDT`；更新預設三幣種可直接用：`npm run pipeline`

Cron / 時間顯示：
- 預設排程為 `2 * * * *`，也就是每小時第 2 分鐘執行
- 預設時區為 `Asia/Taipei`，可用 `CHRONOS_CRON_TIMEZONE` 覆蓋
- `npm run cron` 啟動後預設會先跑一次，再等待下一個排程；若只想等待排程可設 `CHRONOS_RUN_ON_STARTUP=false`
- Binance API 會回傳正在形成中的最新 K 線，系統會自動排除尚未收盤的 K，只用已收盤資料產生訊號
- 若舊版曾把未收盤 K 的訊號寫進 history，下一次 pipeline / cron 會自動移除超過最新已收盤 K 的歷史訊號
- Dashboard 時間以 `Asia/Taipei` 顯示；JSON 內 timestamp 仍是毫秒時間戳，可跨時區穩定驗證

---

## 專案結構

```
chronos/
├── backend/
│   ├── public/
│   │   └── index.html              # Dashboard 前端
│   └── src/
│       ├── scripts/
│       │   ├── fetchBTC.js         # 抓資料入口
│       │   ├── runVerification.js  # 執行驗證
│       │   ├── runPipelineOnce.js  # 單次完整 pipeline
│       │   ├── cronJob.js          # 本地排程執行 pipeline
│       │   ├── generateDailyReport.js # 產生每日報告
│       │   ├── testSignals.js      # 訊號邏輯測試
│       │   └── dashboardServer.js  # HTTP Server（port 3001）
│       ├── services/
│       │   ├── binanceService.js   # Binance API 封裝
│       │   ├── indicatorService.js # 技術指標計算
│       │   ├── signalService.js    # 訊號產生策略
│       │   ├── llmService.js       # OpenAI / Groq LLM 封裝
│       │   ├── pipelineService.js  # 抓資料、指標、訊號、驗證、存檔
│       │   └── verifyService.js    # 延遲驗證邏輯
│       └── utils/
│           ├── saveJson.js         # 檔案儲存工具
│           ├── signalHistory.js    # 歷史訊號 upsert
│           └── symbols.js          # 多幣種設定與檔名工具
├── data/                           # 自動產生，勿手動編輯
│   ├── btcusdt_1h.json
│   ├── ethusdt_1h.json
│   ├── solusdt_1h.json
│   ├── *_1h_verified.json
│   └── *_1h_history.json
├── docs/
├── llm.md                          # LLM 協作說明文件
└── README.md
```

---

## 技術指標說明

| 指標 | 用途 |
|---|---|
| EMA 20/50/200 | 趨勢方向判斷（多頭排列 / 空頭排列） |
| RSI 14 | 動能強弱，超買（>70）/ 超賣（<30） |
| MACD | 動能方向確認（Histogram 正負） |
| ATR 14 | 波動率，作為 SL/TP 計算基準 |
| ADX 14 | 趨勢強度（>25 趨勢盤，<20 震盪盤） |
| Bollinger Bands | 價格相對位置 |

---

## 訊號策略

### TREND_LONG（趨勢順勢做多）
EMA 多頭排列 + RSI 45~65 + 收盤在 EMA20 上方 + MACD 向上

### TREND_SHORT（趨勢順勢做空）
EMA 空頭排列 + RSI 35~55 + 收盤在 EMA20 下方 + MACD 向下

### OVERSOLD_BOUNCE（超賣反彈）
RSI < 30 + 成交量放大 + 大趨勢偏多（收盤在 EMA200 上方）

### OBS_BIAS_LONG / OBS_BIAS_SHORT（觀察型方向預測）
每根 1H 收盤 K 依 EMA、RSI、MACD、ADX 做方向投票，用於看盤輔助與累積可驗證樣本。
這類訊號的 `signalType` 為 `OBSERVATION`，不等同正式交易策略。

---

## 驗證系統

每筆訊號使用 **ATR 倍數**定義止盈止損（跨幣種可比較）：

| 價位 | 計算 | RR |
|---|---|---|
| SL | 進場價 ± 1.5 × ATR | — |
| TP1 | 進場價 ± 1.5 × ATR | 1:1 |
| TP2 | 進場價 ± 3.0 × ATR | 1:2 |
| TP3 | 進場價 ± 4.5 × ATR | 1:3 |

驗證結果記錄：
- **outcome**：WIN_TP1 / WIN_TP2 / WIN_TP3 / LOSS / TIMEOUT_PROFIT / TIMEOUT_LOSS / PENDING_PROFIT / PENDING_LOSS
- **R 倍數**：+3 表示賺了 3R，-1 表示完整止損
- **MFE**：Maximum Favorable Excursion（進場後最大有利波動）
- **MAE**：Maximum Adverse Excursion（進場後最大不利波動）

`PENDING_*` 代表後續 K 線尚未滿驗證視窗，僅表示目前暫時有利或不利，不列入正式勝率。

---

## Dashboard

啟動後訪問 `http://localhost:3001`

| 區域 | 內容 |
|---|---|
| 左上 | 各策略勝率、平均 R、勝敗統計 |
| 左下 | 訊號列表（點擊查看詳情） |
| 右上 | K 線圖 + EMA 三線 + 訊號標記點 |
| 右下 | 點擊訊號後顯示完整 SL/TP/MFE/MAE |

---

## 注意事項

- 樣本數 < 50 筆時，勝率統計不具參考意義
- 目前預設支援 BTCUSDT、ETHUSDT、SOLUSDT；多幣種策略參數尚未個別最佳化
- DOGEUSDT 暫時移出預設清單，之後會等 meme / 小幣專用策略完成再加入觀察
- 資料來源為 Binance 公開 API（與 BingX 有微小價差）
- 本工具僅供研究用途，不構成投資建議

---

## 開發路線圖

- [x] Step 6：多時間框架資料抓取
- [x] Step 7：技術指標計算
- [x] Step 8：規則型訊號產生
- [x] Step 9：延遲驗證系統
- [x] Step 10：Dashboard
- [x] Step 11：Cron Job 自動定時執行
- [x] Step 11.5：訊號品質控管（transition filter + cooldown）
- [x] Step 12：多幣種擴展（ETH、SOL）
- [x] Step 13：LLM 整合（訊號解釋 / 每日報告）
- [x] Step 13.5：OBS 觀察型方向預測與 pending 驗證
- [ ] Step 14：PostgreSQL 資料庫遷移

---

## License

MIT
