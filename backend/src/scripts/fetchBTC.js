const { fetchMultiTimeframe } = require("../services/binanceService");
const { calcAllIndicators } = require("../services/indicatorService");
const { saveJson } = require("../utils/saveJson");
const { dataFilename, parseSymbols } = require("../utils/symbols");

async function main() {
  try {
    const symbols = parseSymbols(process.env.CHRONOS_SYMBOLS || process.env.CHRONOS_SYMBOL);

    for (const symbol of symbols) {
      console.log(`[fetchBTC] Fetching ${symbol} multi-timeframe data`);

      const multiTF = await fetchMultiTimeframe(symbol);

      for (const [tf, klines] of Object.entries(multiTF)) {
        const withIndicators = calcAllIndicators(klines);
        const validCount = withIndicators.filter((k) => k.indicators.ema200 !== null).length;

        console.log(`[fetchBTC] ${symbol} ${tf}: candles=${klines.length}, fullIndicators=${validCount}`);
        await saveJson(dataFilename(symbol, tf), withIndicators);
      }
    }

    console.log("[fetchBTC] Done");
  } catch (err) {
    console.error("[fetchBTC] Error:", err.message);
    process.exit(1);
  }
}

main();
