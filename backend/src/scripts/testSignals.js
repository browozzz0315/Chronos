/**
 * testSignals.js
 * Verify signalService behavior.
 * Run: node src/scripts/testSignals.js
 *
 * This script does not call external APIs. It reads local candle data and
 * verifies signal logic without network access.
 */

const fs   = require("fs");
const path = require("path");
const { generateSignals } = require("../services/signalService");
const { dataFilename, legacyDataFilename, normalizeSymbol } = require("../utils/symbols");

function loadLocalData(filename) {
  const filePath = path.join(__dirname, "../../../data", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到檔案: ${filePath}\n請先執行 fetchBTC.js 產生資料`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function loadSymbolData(symbol, suffix) {
  const filename = dataFilename(symbol, suffix);
  const filePath = path.join(__dirname, "../../../data", filename);

  if (fs.existsSync(filePath)) {
    return loadLocalData(filename);
  }

  return loadLocalData(legacyDataFilename(symbol, suffix));
}

function formatTime(ms) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function printDivider(title = "") {
  const line = "─".repeat(60);
  console.log(title ? `\n${line}\n  ${title}\n${line}` : line);
}

// ─────────────────────────────────────────────
// Test 1: data integrity checks.
// ─────────────────────────────────────────────
function testDataIntegrity(klines) {
  printDivider("TEST 1: 資料完整性");

  let floatOk = true;
  let indicatorOk = true;
  let nullCount = { ema200: 0, rsi14: 0, adx: 0 };

  for (const k of klines) {
    // Type check.
    if (typeof k.close !== "number") floatOk = false;

    // Null counts are expected during indicator warm-up.
    if (k.indicators.ema200 == null) nullCount.ema200++;
    if (k.indicators.rsi14  == null) nullCount.rsi14++;
    if (k.indicators.adx    == null) nullCount.adx++;
  }

  console.log(`  總根數       : ${klines.length}`);
  console.log(`  OHLCV型別   : ${floatOk ? "✅ 全部 Float" : "❌ 有 String！"}`);
  console.log(`  EMA200 null : ${nullCount.ema200} 根（需 200 根暖機）`);
  console.log(`  RSI14  null : ${nullCount.rsi14} 根`);
  console.log(`  ADX    null : ${nullCount.adx} 根`);

  const latest = klines[klines.length - 1];
  console.log(`\n  最新一根：${formatTime(latest.openTime)}`);
  console.log(`    Close   : ${latest.close}`);
  console.log(`    EMA20   : ${latest.indicators.ema20}`);
  console.log(`    EMA50   : ${latest.indicators.ema50}`);
  console.log(`    EMA200  : ${latest.indicators.ema200 ?? "null（資料不足）"}`);
  console.log(`    RSI14   : ${latest.indicators.rsi14}`);
  console.log(`    ADX     : ${latest.indicators.adx ?? "null"}`);
  console.log(`    Market  : ${latest.indicators.marketState}`);

  return floatOk && indicatorOk;
}

// ─────────────────────────────────────────────
// Test 2: signal generation results.
// ─────────────────────────────────────────────
function testSignalGeneration(klines, symbol) {
  printDivider("TEST 2: 訊號產生結果");

  const signals = generateSignals(klines, { symbol });

  // Group signals by strategy.
  const byStrategy = {};
  for (const sig of signals) {
    if (!byStrategy[sig.strategy]) byStrategy[sig.strategy] = [];
    byStrategy[sig.strategy].push(sig);
  }

  console.log(`  總訊號數 : ${signals.length}`);
  for (const [name, arr] of Object.entries(byStrategy)) {
    console.log(`    ${name.padEnd(20)}: ${arr.length} 個`);
  }

  // Print the latest signal detail for each strategy.
  console.log("\n  ── 各策略最新訊號詳情 ──");
  for (const [name, arr] of Object.entries(byStrategy)) {
    const sig = arr[arr.length - 1];
    console.log(`\n  [${name}]`);
    console.log(`    時間       : ${formatTime(sig.openTime)}`);
    console.log(`    方向       : ${sig.direction}`);
    console.log(`    進場價     : ${sig.entryPrice}`);
    console.log(`    觸發條件   :`);
    for (const [cond, val] of Object.entries(sig.conditions)) {
      console.log(`      ${val ? "✅" : "❌"} ${cond}`);
    }
    console.log(`    指標快照   :`, sig.snapshot);
  }

  return signals;
}

// ─────────────────────────────────────────────
// Test 3: boundary cases with synthetic candles.
// Confirms that strategy condition checks work as expected.
// ─────────────────────────────────────────────
function testStrategyLogic() {
  printDivider("TEST 3: 策略邏輯邊界驗證（假資料）");

  const { strategyTrendLong, strategyOversoldBounce } = require("../services/signalService");

  // Case A: should trigger TREND_LONG.
  const bullishKline = {
    close: 80000, volume: 500,
    indicators: {
      ema20: 79500, ema50: 78000, ema200: 75000,
      rsi14: 55, macdHist: 100, adx: 30,
      marketState: "UPTREND_NORMAL",
    },
  };
  const resultA = strategyTrendLong(bullishKline, 5, new Array(10).fill(bullishKline));
  console.log(`  Case A (應觸發 TREND_LONG)    : ${resultA ? "✅ 觸發" : "❌ 未觸發"}`);

  // Case B: bearish EMA alignment should not trigger TREND_LONG.
  const bearishKline = {
    close: 70000, volume: 300,
    indicators: {
      ema20: 71000, ema50: 72000, ema200: 75000,
      rsi14: 45, macdHist: -50, adx: 28,
      marketState: "DOWNTREND_NORMAL",
    },
  };
  const resultB = strategyTrendLong(bearishKline, 5, new Array(10).fill(bearishKline));
  console.log(`  Case B (空頭排列，不觸發LONG) : ${resultB === null ? "✅ 正確未觸發" : "❌ 錯誤觸發了！"}`);

  // Case C: oversold RSI plus volume surge should trigger OVERSOLD_BOUNCE.
  const prevKline = { open: 70500, close: 70000, volume: 200 };
  const oversoldKline = {
    close: 69500, volume: 500,
    indicators: { rsi14: 25, ema200: 65000 },
  };
  const mockHistory = [...new Array(20).fill({ open: 71000, close: 70500, volume: 200 }), prevKline, oversoldKline];
  const resultC = strategyOversoldBounce(oversoldKline, mockHistory.length - 1, mockHistory);
  console.log(`  Case C (超賣反彈，應觸發)     : ${resultC ? "✅ 觸發" : "❌ 未觸發"}`);

  // Case D: oversold below EMA200 should not trigger.
  const oversoldBelowEMA = {
    close: 60000, volume: 500,
    indicators: { rsi14: 25, ema200: 65000 },  // Close < EMA200.
  };
  const mockHistory2 = [...new Array(20).fill({ open: 61000, close: 60500, volume: 200 }), prevKline, oversoldBelowEMA];
  const resultD = strategyOversoldBounce(oversoldBelowEMA, mockHistory2.length - 1, mockHistory2);
  console.log(`  Case D (EMA200下方，不觸發)   : ${resultD === null ? "✅ 正確未觸發" : "❌ 錯誤觸發了！"}`);
}

// ─────────────────────────────────────────────
// Execute.
// ─────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║       Chronos Signal Service 驗證測試        ║");
  console.log("╚══════════════════════════════════════════════╝");

  try {
    const symbol = normalizeSymbol(process.env.CHRONOS_SYMBOL || process.argv[2] || "BTCUSDT");
    const klines = loadSymbolData(symbol, "1h");

    const dataOk = testDataIntegrity(klines);
    if (!dataOk) {
      console.error("\n❌ 資料完整性有問題，請先修正再跑訊號");
      process.exit(1);
    }

    const signals = testSignalGeneration(klines, symbol);
    testStrategyLogic();

    printDivider("結論");
    if (signals.length === 0) {
      console.log("  ⚠️  目前資料沒有觸發任何訊號");
      console.log("  原因可能是：");
      console.log("    1. 只有 100 根，EMA200 全為 null → 策略 A/C 無法觸發");
      console.log("    2. 市場狀態不符合任何策略條件");
      console.log("  → 執行 fetchBTC.js 抓 300 根後再測試");
    } else {
      console.log(`  ✅ 訊號邏輯正常，共產生 ${signals.length} 個訊號`);
      console.log("  → 下一步：Step 9 延遲驗證系統");
    }

  } catch (err) {
    console.error("\n❌ 錯誤:", err.message);
    process.exit(1);
  }
}

main();
