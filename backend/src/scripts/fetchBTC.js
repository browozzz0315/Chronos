/**
 * fetchBTC.js
 * 抓取 BTC 多時間框架資料 + 計算技術指標
 * 執行：node src/scripts/fetchBTC.js
 */

const { fetchMultiTimeframe } = require("../services/binanceService");
const { calcAllIndicators }   = require("../services/indicatorService");
const { saveJson }            = require("../utils/saveJson");

async function main() {
  try {
    const symbol = "BTCUSDT";
    console.log(`[fetchBTC] Fetching ${symbol} multi-timeframe...`);

    // 1. 抓資料（1h / 4h / 1d）
    const multiTF = await fetchMultiTimeframe(symbol);

    // 2. 計算指標
    const result = {};
    for (const [tf, klines] of Object.entries(multiTF)) {
      const withIndicators = calcAllIndicators(klines);
      result[tf] = withIndicators;

      // 只存有完整指標的根（去掉前面 null 太多的初始段）
      // EMA200 需要 200 根才開始有值，但原始資料還是完整保留
      const validCount = withIndicators.filter(
        (k) => k.indicators.ema200 !== null
      ).length;

      console.log(
        `[fetchBTC] ${tf}: ${klines.length} candles, ` +
        `${validCount} with full indicators`
      );

      // 最新一根的指標快照，方便 debug
      const latest = withIndicators[withIndicators.length - 1];
      console.log(`[fetchBTC] ${tf} latest:`, {
        time:        new Date(latest.openTime).toISOString(),
        close:       latest.close,
        rsi14:       latest.indicators.rsi14,
        ema20:       latest.indicators.ema20,
        ema50:       latest.indicators.ema50,
        ema200:      latest.indicators.ema200,
        adx:         latest.indicators.adx,
        marketState: latest.indicators.marketState,
      });
    }

    // 3. 存檔（分開存，避免單檔太大）
    for (const [tf, data] of Object.entries(result)) {
      saveJson(`btc_${tf}.json`, data);
    }

    console.log("[fetchBTC] Done.");
  } catch (err) {
    console.error("[fetchBTC] Error:", err.message);
    process.exit(1);
  }
}

main();