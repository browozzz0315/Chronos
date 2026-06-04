const { fetchMultiTimeframe } = require("./binanceService");
const { calcAllIndicators } = require("./Indicatorservice");
const { generateSignals } = require("./signalService");
const { verifyAll, summarize } = require("./verifyService");
const { saveJson } = require("../utils/saveJson");
const { enrichSignalsWithExplanations, isLlmEnabled } = require("./llmService");
const { loadHistory, mergeSignalsWithHistory, upsertSignalHistory } = require("../utils/signalHistory");
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
  const latestBaseKline = baseKlines[baseKlines.length - 1] || null;
  const signals = generateSignals(baseKlines, { symbol: normalizedSymbol });
  const verifiedFilename = dataFilename(normalizedSymbol, "1h_verified");
  const historyFilename = dataFilename(normalizedSymbol, "1h_history");
  const history = loadHistory(historyFilename);
  const verified = mergeSignalsWithHistory(
    verifyAll(signals, baseKlines, verifyBars),
    history
  );
  const llmResult = await enrichSignalsWithExplanations(verified, options.llm);
  const finalVerified = llmResult.signals;
  const summary = summarize(finalVerified);

  await saveJson(verifiedFilename, finalVerified);
  const historyStats = await upsertSignalHistory(historyFilename, finalVerified);

  return {
    symbol: normalizedSymbol,
    signals,
    verified: finalVerified,
    summary,
    historyStats,
    llm: {
      enabled: isLlmEnabled(options.llm?.provider),
      provider: llmResult.provider,
      generated: llmResult.generated,
      skipped: llmResult.skipped,
      selected: llmResult.selected || 0,
      rateLimited: Boolean(llmResult.rateLimited),
    },
    dataWindow: latestBaseKline
      ? {
        latestOpenTime: latestBaseKline.openTime,
        latestCloseTime: latestBaseKline.closeTime,
      }
      : null,
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
