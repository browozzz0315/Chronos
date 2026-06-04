const { fetchMultiTimeframe } = require("./binanceService");
const { calcAllIndicators } = require("./Indicatorservice");
const { generateSignals } = require("./signalService");
const { verifyAll, summarize } = require("./verifyService");
const { saveJson } = require("../utils/saveJson");
const { upsertSignalHistory } = require("../utils/signalHistory");
const { dataFilename, normalizeSymbol } = require("../utils/symbols");

async function runPipeline(symbol = "BTCUSDT", options = {}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const verifyBars = options.verifyBars ?? 24;
  const multiTF = await fetchMultiTimeframe(normalizedSymbol);
  const result = {};

  for (const [tf, klines] of Object.entries(multiTF)) {
    result[tf] = calcAllIndicators(klines);
    await saveJson(dataFilename(normalizedSymbol, tf), result[tf]);
  }

  const baseKlines = result["1h"] || [];
  const signals = generateSignals(baseKlines, { symbol: normalizedSymbol });
  const verified = verifyAll(signals, baseKlines, verifyBars);
  const summary = summarize(verified);

  await saveJson(dataFilename(normalizedSymbol, "1h_verified"), verified);
  const historyStats = await upsertSignalHistory(
    dataFilename(normalizedSymbol, "1h_history"),
    verified
  );

  return {
    symbol: normalizedSymbol,
    signals,
    verified,
    summary,
    historyStats,
    klinesByTimeframe: result,
  };
}

async function runPipelines(symbols, options = {}) {
  const results = [];

  for (const symbol of symbols) {
    results.push(await runPipeline(symbol, options));
  }

  return results;
}

module.exports = { runPipeline, runPipelines };
