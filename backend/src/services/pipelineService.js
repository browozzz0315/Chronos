const { fetchMultiTimeframe } = require("./binanceService");
const { calcAllIndicators } = require("./indicatorService");
const { generateSignals } = require("./signalService");
const { verifyAll, summarize } = require("./verifyService");
const { saveJson } = require("../utils/saveJson");

async function runPipeline(symbol = "BTCUSDT", options = {}) {
  const verifyBars = options.verifyBars ?? 24;
  const multiTF = await fetchMultiTimeframe(symbol);
  const result = {};

  for (const [tf, klines] of Object.entries(multiTF)) {
    result[tf] = calcAllIndicators(klines);
    await saveJson(`btc_${tf}.json`, result[tf]);
  }

  const baseKlines = result["1h"] || [];
  const signals = generateSignals(baseKlines);
  const verified = verifyAll(signals, baseKlines, verifyBars);
  const summary = summarize(verified);

  await saveJson("btc_1h_verified.json", verified);

  return {
    symbol,
    signals,
    verified,
    summary,
    klinesByTimeframe: result,
  };
}

module.exports = { runPipeline };
