# Chronos LLM Implementation Notes

This file is the implementation reference for future LLM / agent work on Chronos.
It intentionally uses English only to avoid terminal encoding issues, while keeping
the original documentation structure and purpose.

---

## 1. Project Goal

Chronos is a market-analysis side project for crypto signals.

Core principles:
- Do not predict exact future prices.
- Verify whether rule-based strategies have statistical edge.
- Every signal must keep the full indicator snapshot at trigger time.
- Market state classification is required before win-rate interpretation.
- MVP scope is strict: no live trading, no complex ML, no exchange order execution.

Current target usage:
- Assist chart-reading decisions.
- Accumulate verified strategy samples over time.
- Compare strategy behavior across symbols and market states.
- Use LLM only for explanation and reporting, not for generating trade entries.

---

## 2. Current Development Status (as of 2026-06-06)

### Completed

| Step | Module | Status |
|---|---|---|
| 6 | `binanceService.js` | Multi-timeframe Binance OHLCV fetch for 1h / 4h / 1d. Numeric OHLCV conversion is required before saving. Closed-candle filtering avoids using unfinished Binance candles. |
| 7 | `Indicatorservice.js` | Hand-written indicators: EMA20/50/200, RSI14, MACD, ATR14, ADX14, Bollinger Bands, market-state classification. |
| 8 | `signalService.js` | Rule-based signal generation. Current formal strategies: `TREND_LONG`, `TREND_SHORT`, `PULLBACK_LONG`, `PULLBACK_SHORT`, `OVERSOLD_BOUNCE`. Helper signals: `TREND_*_CONTINUATION`, `OBS_BIAS_LONG`, `OBS_BIAS_SHORT`. |
| 9 | `verifyService.js` | Delayed verification with ATR-based SL/TP, R multiple, PnL %, MFE, MAE, pending outcomes. |
| 10 | `dashboardServer.js` + `index.html` | Local HTTP dashboard on port 3001 with API endpoints, multi-symbol selector, candlestick overlay, signal markers, summary stats, detail panel, LLM explanation display, light/dark theme. |
| 11 | `cronJob.js` + `pipelineService.js` | Scheduled pipeline. Default cron: `2 * * * *`, timezone `Asia/Taipei`. Includes startup run, overlap protection, closed-candle logging. |
| 11.5 | signal quality controls | Cooldown, transition filter for strict trend entries, continuation markers, history pruning for stale future/unclosed samples. |
| 12 | multi-symbol support | Default symbols: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`. File naming: `{symbol.toLowerCase()}_{suffix}.json`. BTC legacy fallback is still supported for old `btc_*.json` files. |
| 13 | LLM integration | OpenAI / Groq support for signal explanations and daily reports. Batch explanation is enabled by default to reduce 429 risk. |
| 13.5 | observation signals | `OBS_BIAS_LONG / OBS_BIAS_SHORT` create closed-candle directional samples for watchlist and statistics. |
| 13.6 | pullback strategies | `PULLBACK_LONG / PULLBACK_SHORT` add formal second-entry trend pullback signals. |

### Not Completed

| Step | Scope | Priority |
|---|---|---|
| 14 | PostgreSQL migration to replace JSON persistence and support cross-symbol queries. | Medium |
| 15 | Dedicated meme / small-cap strategies if DOGE or similar symbols are reintroduced. | Low / later |
| 16 | Optional cleanup of remaining mojibake prompt strings in source files. | Low, non-business-logic |

---

## 3. Project Structure

```text
chronos/
|-- backend/
|   |-- public/
|   |   `-- index.html                  # Dashboard frontend
|   `-- src/
|       |-- scripts/
|       |   |-- fetchBTC.js             # Legacy/manual fetch entry
|       |   |-- runVerification.js      # Manual delayed verification
|       |   |-- runPipelineOnce.js      # One-shot full pipeline
|       |   |-- cronJob.js              # Scheduled pipeline runner
|       |   |-- generateDailyReport.js  # LLM/local daily report generator
|       |   |-- testSignals.js          # Local signal tests
|       |   `-- dashboardServer.js      # HTTP dashboard server, port 3001
|       |-- services/
|       |   |-- binanceService.js       # Binance API wrapper
|       |   |-- Indicatorservice.js     # Indicator calculation, filename casing is important
|       |   |-- signalService.js        # Rule-based signal generator
|       |   |-- verifyService.js        # Delayed verification and summary
|       |   |-- llmService.js           # OpenAI / Groq wrapper
|       |   `-- pipelineService.js      # fetch -> indicators -> signals -> verify -> LLM -> save
|       `-- utils/
|           |-- saveJson.js             # JSON save helper, writes to ../../../data
|           |-- signalHistory.js        # Persistent signal-history upsert / merge
|           `-- symbols.js              # Symbol normalization and data filenames
|-- data/                               # Runtime output. Do not hand-edit generated JSON.
|   |-- .gitkeep
|   |-- btcusdt_1h.json
|   |-- ethusdt_1h.json
|   |-- solusdt_1h.json
|   |-- *_1h_verified.json
|   |-- *_1h_history.json
|   `-- *_daily_report.md
|-- docs/
|-- README.md                          # User-facing documentation
`-- llm.md                             # This implementation reference
```

---

## 4. Key Design Decisions

### 1. Why are indicators hand-written?

`Indicatorservice.js` calculates all indicators manually instead of using an
external TA package.

Reasons:
- Easier to inspect and debug.
- No dependency version drift.
- Easier future porting to another language.
- Indicator warm-up behavior stays explicit.

### 2. Why use ATR-based SL/TP?

Different symbols have very different volatility.
Fixed price-distance stops are not comparable across BTC, ETH, SOL, DOGE, etc.

Current levels:
- `SL = 1.5 * ATR14`
- `TP1 = 1.5 * ATR14` (`RR 1:1`)
- `TP2 = 3.0 * ATR14` (`RR 1:2`)
- `TP3 = 4.5 * ATR14` (`RR 1:3`)

This makes `R multiple` comparable across symbols.

### 3. Why is market-state classification important?

The same RSI or EMA signal behaves differently in a trend market and a range market.
Mixing all states into one win rate produces misleading statistics.

`classifyMarketState()` labels each candle so verification can later be grouped by
state, such as trend, range, overbought, oversold, or transitional conditions.

### 4. Why rule-based first instead of ML?

The project does not yet have enough verified samples for supervised ML.
Rule-based strategies create labeled historical samples first.
ML can be considered only after enough data is accumulated across months.

### 5. Why JSON first?

JSON is sufficient for MVP speed and local inspection.
The planned PostgreSQL migration should happen after strategy behavior is stable.

### 6. Why closed-candle filtering?

The system should generate signals only on closed candles.
Using unfinished 1h candles would create unstable signals and duplicate predictions.
`binanceService.js` filters Binance rows by close time before saving.

### 7. Why use cooldown and transition filters?

Without quality controls, strict trend strategies would fire repeatedly on every
candle during the same trend leg.

Current defaults in `signalService.js`:
- `cooldownBars = 6`
- `requireTrendTransition = true`
- `includeContinuationSignals = true`
- `includeObservationSignals = true`
- `observationMinScore = 2`

Only `TREND_LONG` and `TREND_SHORT` use the false-to-true transition filter.
Event-like setups such as `PULLBACK_*`, `OVERSOLD_BOUNCE`, continuation, and OBS
do not use that transition filter.

### 8. Why add OBS signals?

Strict formal entries can be rare, which slows down sample collection.
`OBS_BIAS_LONG / OBS_BIAS_SHORT` are watchlist-style directional observations.

They are useful for:
- More frequent market-direction samples.
- Auxiliary dashboard context.
- Statistical observation over time.

They are not the same as formal trade strategies.

### 9. Why add PULLBACK strategies?

After adding OBS, formal trade signals were still too sparse.
`PULLBACK_LONG / PULLBACK_SHORT` add second-entry opportunities when an existing
trend pulls back to EMA20 and resumes in the trend direction.

These are formal `TRADE` signals and are verified like other strategies.

### 10. Why batch LLM explanations?

Sending one request per signal caused rate-limit risk, especially with Groq.
`llmService.js` defaults to batch explanation mode and sends compact signal payloads.

Default LLM behavior:
- Explain only `TRADE` signals.
- Skip pending signals.
- Limit explanations per run.
- Preserve existing `llm.explanation` from signal history.

---

## 5. Signal Strategy Reference

### Signal Types

| `signalType` | Meaning | Verification |
|---|---|---|
| `TRADE` | Formal strategy signal. | Included in normal verification and LLM explanations by default. |
| `CONTINUATION` | Watchlist helper showing a strict trend setup remains valid. | Verified but should not be read as a new formal entry. |
| `OBSERVATION` | Directional observation sample. | Verified for statistics, not a strict trade setup. |

### TREND_LONG

Formal trend-following long entry.

Conditions:
```text
EMA20 > EMA50 > EMA200
RSI14 between 45 and 65
close > EMA20
MACD histogram > 0
ADX >= 20, or ADX unavailable during warm-up
```

Quality control:
```text
signalType = "TRADE"
uses cooldown
uses false-to-true transition filter
```

### TREND_SHORT

Formal trend-following short entry.

Conditions:
```text
EMA20 < EMA50 < EMA200
RSI14 between 35 and 55
close < EMA20
MACD histogram < 0
ADX >= 20, or ADX unavailable during warm-up
```

Quality control:
```text
signalType = "TRADE"
uses cooldown
uses false-to-true transition filter
```

### PULLBACK_LONG

Formal bullish pullback continuation entry.

Purpose:
```text
Capture a second-entry long when the broader EMA trend remains bullish,
price recently tests EMA20, and then reclaims EMA20.
```

Conditions:
```text
current EMA20 > EMA50 > EMA200
previous EMA20 > EMA50 > EMA200
current low <= current EMA20, or previous low <= previous EMA20,
  or previous close <= previous EMA20 * 1.01
current close > current EMA20
RSI14 between 40 and 62
MACD histogram >= 0, or MACD histogram improves from previous candle
ADX >= 20, or ADX unavailable during warm-up
```

Quality control:
```text
signalType = "TRADE"
uses cooldown
does not use false-to-true transition filter
```

### PULLBACK_SHORT

Formal bearish pullback continuation entry.

Purpose:
```text
Capture a second-entry short when the broader EMA trend remains bearish,
price recently retests EMA20 from below, and then rejects under EMA20.
```

Conditions:
```text
current EMA20 < EMA50 < EMA200
previous EMA20 < EMA50 < EMA200
current high >= current EMA20, or previous high >= previous EMA20,
  or previous close >= previous EMA20 * 0.99
current close < current EMA20
RSI14 between 35 and 60
MACD histogram <= 0, or MACD histogram weakens from previous candle
ADX >= 20, or ADX unavailable during warm-up
```

Quality control:
```text
signalType = "TRADE"
uses cooldown
does not use false-to-true transition filter
```

### OVERSOLD_BOUNCE

Formal oversold rebound long entry.

Conditions:
```text
RSI14 < 30
current volume > 20-candle average volume * 1.3
close > EMA200
previous candle is bearish
```

Quality control:
```text
signalType = "TRADE"
uses cooldown
does not use false-to-true transition filter
```

### TREND_LONG_CONTINUATION / TREND_SHORT_CONTINUATION

Continuation helper signal.

Conditions:
```text
The matching TREND_LONG or TREND_SHORT setup is valid on both:
- previous candle
- current candle
```

Use:
```text
Watchlist marker only.
Do not treat it as a separate formal entry.
signalType = "CONTINUATION"
```

### OBS_BIAS_LONG / OBS_BIAS_SHORT

Observation-style directional signal.

Voting inputs:
```text
price vs EMA20
EMA20 vs EMA50
EMA50 vs EMA200
MACD histogram sign
RSI zone
ADX trend bonus when ADX >= 20
```

Use:
```text
More frequent closed-candle observation samples.
Not a strict trading strategy.
signalType = "OBSERVATION"
```

---

## 6. Verification System

### Result Object Shape

Each verified signal is expected to look like this:

```json
{
  "id": "PULLBACK_SHORT_1780000000000",
  "openTime": 1780000000000,
  "symbol": "BTCUSDT",
  "entryPrice": 60951.64,
  "signalType": "TRADE",
  "strategy": "PULLBACK_SHORT",
  "direction": "SHORT",
  "conditions": {
    "ema_alignment": true,
    "previous_ema_alignment": true,
    "touched_ema20": true,
    "rejected_ema20": true,
    "rsi_rejected": true,
    "macd_weakening": true,
    "adx_trending": true
  },
  "snapshot": {
    "close": 60951.64,
    "high": 61176,
    "ema20": 61481.1,
    "ema50": 62784.21,
    "ema200": 68138.97,
    "rsi14": 43.68,
    "macdHist": 98.9487,
    "adx": 34.46,
    "marketState": "DOWNTREND_NORMAL"
  },
  "quality": {
    "cooldownBars": 6,
    "barsSinceLastSignal": null,
    "transitionEntry": false
  },
  "verification": {
    "outcome": "PENDING_PROFIT",
    "exitPrice": 60400,
    "exitReason": "PENDING",
    "exitBar": 4,
    "checkedBars": 4,
    "isComplete": false,
    "rMultiple": 0.8,
    "pnlPct": 0.9,
    "tp1Hit": false,
    "tp2Hit": false,
    "tp3Hit": false,
    "slHit": false,
    "mfe": 900,
    "mae": 200,
    "levels": {
      "sl": 62000,
      "tp1": 59900,
      "tp2": 58900,
      "tp3": 57900,
      "slDist": 1048.36
    }
  },
  "llm": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "generatedAt": "2026-06-06T00:00:00.000Z",
    "explanation": "Short natural-language explanation."
  }
}
```

### Outcomes

| Outcome | Meaning |
|---|---|
| `WIN_TP1` | TP1 was reached before final timeout. |
| `WIN_TP2` | TP2 was reached before final timeout. |
| `WIN_TP3` | TP3 was reached and the signal is complete. |
| `LOSS` | SL was reached before TP1. |
| `TIMEOUT_PROFIT` | Max verification window completed with positive R but no TP classification above. |
| `TIMEOUT_LOSS` | Max verification window completed with non-positive R. |
| `PENDING_PROFIT` | Not enough future candles yet; current temporary result is positive. |
| `PENDING_LOSS` | Not enough future candles yet; current temporary result is non-positive. |
| `NOT_FOUND` | Entry candle is not present in the provided candle array. |

Pending signals are excluded from `summarize()` totals and win-rate calculations.

---

## 7. Pipeline Behavior

### Main Pipeline

`runPipeline(symbol)` performs:

```text
fetchMultiTimeframe(symbol)
-> calcAllIndicators() for each timeframe
-> save {symbol}_1h / 4h / 1d JSON
-> generateSignals() on 1h data
-> verifyAll() with maxBars = 24
-> merge previous LLM explanations from history
-> enrich selected signals with LLM explanations
-> save {symbol}_1h_verified.json
-> upsert {symbol}_1h_history.json
```

### Default Symbols

```text
BTCUSDT
ETHUSDT
SOLUSDT
```

Override with:

```powershell
$env:CHRONOS_SYMBOLS="BTCUSDT,ETHUSDT,SOLUSDT"
```

### Data Filenames

| File | Meaning |
|---|---|
| `{symbol}_1h.json` | 1h candles with indicators. |
| `{symbol}_4h.json` | 4h candles with indicators. |
| `{symbol}_1d.json` | 1d candles with indicators. |
| `{symbol}_1h_verified.json` | Current verified signal window for dashboard. |
| `{symbol}_1h_history.json` | Persistent merged signal history. |
| `{symbol}_daily_report.md` | Daily LLM or fallback report. |

Example:

```text
btcusdt_1h.json
ethusdt_1h_verified.json
solusdt_daily_report.md
```

---

## 8. Cron Behavior

Default:

```text
CHRONOS_CRON_SCHEDULE = "2 * * * *"
CHRONOS_CRON_TIMEZONE = "Asia/Taipei"
CHRONOS_RUN_ON_STARTUP = true
```

Meaning:
- Run once immediately when `npm run cron` starts, unless disabled.
- Then run every hour at minute 2 in `Asia/Taipei`.
- The run uses the latest closed 1h candle, not the unfinished current candle.
- Overlapping cycles are skipped if the previous cycle is still running.

Useful environment variables:

```powershell
$env:CHRONOS_CRON_SCHEDULE="2 * * * *"
$env:CHRONOS_CRON_TIMEZONE="Asia/Taipei"
$env:CHRONOS_RUN_ON_STARTUP="false"
```

---

## 9. LLM Integration

Supported providers:

| Provider | Required env | Default model |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-5-mini` |
| Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |

Provider resolution:

```text
CHRONOS_LLM_PROVIDER=openai | groq | auto
```

If provider is `auto`:
1. Use OpenAI when `OPENAI_API_KEY` exists.
2. Otherwise use Groq when `GROQ_API_KEY` exists.
3. Otherwise disable LLM and continue with local outputs.

Default explanation behavior:

```text
CHRONOS_LLM_BATCH_EXPLANATIONS=true
CHRONOS_LLM_EXPLAIN_SIGNALS=trade
CHRONOS_LLM_MAX_EXPLANATIONS_PER_RUN=5
CHRONOS_LLM_SKIP_PENDING=true
CHRONOS_LLM_DELAY_MS=1200
CHRONOS_LLM_RETRY_429_DELAY_MS=5000
```

Explanation modes:

| Mode | Behavior |
|---|---|
| `trade` | Explain only formal `TRADE` signals. Default. |
| `all` | Explain all signal types. High token and rate-limit risk. |
| `observation` | Explain only OBS signals. Usually not recommended. |
| `continuation` | Explain only continuation markers. |
| `none` | Disable signal explanation selection. |

Important:
- ChatGPT Plus subscription is not the same as OpenAI API access.
- OpenAI API requires an API key and separate billing.
- Groq API requires `GROQ_API_KEY`.
- LLM output is explanatory only and must not change signal logic.

---

## 10. Dashboard Behavior

Run:

```powershell
cd backend
npm run dashboard
```

Open:

```text
http://localhost:3001
```

API endpoints:

| Endpoint | Description |
|---|---|
| `/api/symbols` | Supported symbols and data availability. |
| `/api/klines?symbol=BTCUSDT` | 1h candles filtered after EMA200 warm-up. |
| `/api/signals?symbol=BTCUSDT` | Verified signals for dashboard. |
| `/api/summary?symbol=BTCUSDT` | Strategy summary from verified signals. |

Dashboard features:
- Symbol dropdown for BTC / ETH / SOL.
- Candlestick overlay plus EMA lines.
- Signal markers by signal type.
- Latest signal list limited for readability.
- Detail panel with SL/TP/MFE/MAE and LLM explanation.
- Light/dark theme toggle.
- Timestamps display in `Asia/Taipei`.

Strategy display labels:

| Strategy | UI label |
|---|---|
| `TREND_LONG` | trend long label |
| `TREND_SHORT` | trend short label |
| `PULLBACK_LONG` | pullback long label |
| `PULLBACK_SHORT` | pullback short label |
| `OVERSOLD_BOUNCE` | oversold bounce label |
| `TREND_*_CONTINUATION` | continuation label |
| `OBS_BIAS_*` | observation label |

The exact visible labels are maintained in `backend/public/index.html`.

---

## 11. Local Test Snapshot

Latest local signal test after adding PULLBACK strategies:

```text
Command:
node backend/src/scripts/testSignals.js BTCUSDT

Result:
Signal logic passed.
BTCUSDT local 300-candle window:
- OBS_BIAS_SHORT: 98
- PULLBACK_SHORT: 6
- TREND_SHORT: 5
- TREND_SHORT_CONTINUATION: 8
```

Additional local non-OBS counts:

```text
BTCUSDT: PULLBACK_SHORT 6, TREND_SHORT 5, TREND_SHORT_CONTINUATION 8
ETHUSDT: PULLBACK_SHORT 6, TREND_SHORT 7, TREND_SHORT_CONTINUATION 10
SOLUSDT: PULLBACK_SHORT 5, TREND_SHORT 9, TREND_SHORT_CONTINUATION 13
```

Interpretation:
- Sample sizes are still small.
- These numbers are useful for sanity checking only.
- Do not use them as statistical evidence yet.

---

## 12. Commands

From `backend/`:

```powershell
npm install
npm run pipeline
npm run pipeline -- BTCUSDT
npm run verify -- BTCUSDT
npm run report:daily -- BTCUSDT
npm run test:signals -- BTCUSDT
npm run dashboard
npm run cron
```

With Groq:

```powershell
$env:GROQ_API_KEY="your_groq_key"
$env:CHRONOS_LLM_PROVIDER="groq"
npm run pipeline -- BTCUSDT
```

With OpenAI:

```powershell
$env:OPENAI_API_KEY="your_openai_key"
$env:CHRONOS_LLM_PROVIDER="openai"
npm run pipeline -- BTCUSDT
```

Disable LLM for a run by not setting provider API keys, or by setting:

```powershell
$env:CHRONOS_LLM_EXPLAIN_SIGNALS="none"
```

---

## 13. LLM Collaboration Rules

These rules are important for future agents:

1. Scripts are under `backend/src/scripts/`. The project root from there is `../../../`.
2. `Indicatorservice.js` currently uses a capital `I`. Do not rename it casually because imports depend on this casing.
3. Indicator null checks should use `== null` only when intentionally covering both `null` and `undefined`; otherwise use the existing `hasNumber()` helper.
4. Binance OHLCV values can arrive as strings. Convert to numbers before saving.
5. EMA200 requires a 200-candle warm-up. Fetch enough data, currently 300 for 1h.
6. Do not hand-edit generated JSON under `data/` unless the user explicitly asks.
7. Keep signal strategies isolated functions so each strategy can be evaluated separately.
8. Do not merge OBS statistics with formal TRADE strategy statistics.
9. Do not treat `CONTINUATION` markers as fresh formal entries.
10. Preserve `llm.explanation` when re-verifying the same signal id.
11. Keep cron on closed candles only. Do not generate signals from unfinished 1h candles.
12. If adding new strategies, update both `README.md` and this file.
13. If adding new dashboard labels, update `STRATEGY_LABELS` in `backend/public/index.html`.
14. Prefer English comments in source files to avoid terminal encoding issues.
15. Preserve Traditional Chinese user-facing dashboard/log text unless the user asks otherwise.

---

## 14. Next Work Items

### Step 14

PostgreSQL migration:
- Replace JSON persistence.
- Keep history and current verified windows queryable.
- Support cross-symbol, cross-strategy, and market-state statistics.
- Preserve the current JSON workflow until migration is verified.

### Step 15

Dedicated meme / small-cap strategy research:
- DOGEUSDT was replaced by SOLUSDT because current major-coin trend logic produced too few useful DOGE samples.
- If DOGE or smaller coins are reintroduced, do not assume BTC/ETH/SOL rules are optimal.
- Consider volatility breakout, range reversion, liquidity filters, and volume-spike logic.

### Step 16

Non-business-logic cleanup:
- Clean remaining mojibake prompt strings in source files.
- Keep dashboard visible text in Traditional Chinese.
- Keep source comments in English.
