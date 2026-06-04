const fs = require("fs");
const path = require("path");
const { generateSignals } = require("../services/signalService");
const { enrichSignalsWithExplanations, isLlmEnabled } = require("../services/llmService");
const { verifyAll, summarize } = require("../services/verifyService");
const { saveJson } = require("../utils/saveJson");
const { loadHistory, mergeSignalsWithHistory, upsertSignalHistory } = require("../utils/signalHistory");
const { dataFilename, legacyDataFilename, normalizeSymbol } = require("../utils/symbols");

function loadData(filename) {
  const filePath = path.join(__dirname, "../../../data", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing data file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function loadSymbolData(symbol, suffix) {
  const filename = dataFilename(symbol, suffix);
  const legacyFilename = legacyDataFilename(symbol, suffix);
  const filePath = path.join(__dirname, "../../../data", filename);

  if (fs.existsSync(filePath)) {
    return loadData(filename);
  }

  return loadData(legacyFilename);
}

function formatTime(ms) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function printDivider(title = "") {
  const line = "-".repeat(62);
  console.log(title ? `\n${line}\n${title}\n${line}` : line);
}

async function main() {
  console.log("Chronos verification run");

  const symbol = normalizeSymbol(process.env.CHRONOS_SYMBOL || process.argv[2] || "BTCUSDT");
  const klines = loadSymbolData(symbol, "1h");
  const signals = generateSignals(klines, { symbol });
  const historyFilename = dataFilename(symbol, "1h_history");
  const verifiedFilename = dataFilename(symbol, "1h_verified");
  const history = loadHistory(historyFilename);
  const verified = mergeSignalsWithHistory(verifyAll(signals, klines, 24), history);
  const llmResult = await enrichSignalsWithExplanations(verified);
  const finalVerified = llmResult.signals;
  const summary = summarize(finalVerified);

  console.log(`Symbol: ${symbol}`);
  console.log(`Loaded ${klines.length} candles`);
  console.log(`Range: ${formatTime(klines[0].openTime)} -> ${formatTime(klines[klines.length - 1].openTime)}`);
  console.log(`Signals: ${signals.length}`);

  printDivider("Verification results");
  for (const sig of finalVerified) {
    const v = sig.verification;
    console.log(
      `${sig.strategy} ${sig.direction} @ ${formatTime(sig.openTime)} -> ${v.outcome} ` +
      `(R=${v.rMultiple > 0 ? "+" : ""}${v.rMultiple}, exit=${v.exitReason})`
    );
  }

  printDivider("Strategy summary");
  if (!Object.keys(summary).length) {
    console.log("No verifiable signals yet");
  } else {
    for (const [name, s] of Object.entries(summary)) {
      const extra = s.total < 5 ? " sample too small" : "";
      console.log(
        `${name}: total=${s.total}, wins=${s.wins}, losses=${s.losses}, ` +
        `timeouts=${s.timeouts}, winRate=${s.winRate}%, avgR=${s.avgR}${extra}`
      );
    }
  }

  await saveJson(verifiedFilename, finalVerified);
  console.log(`Saved data/${verifiedFilename}`);
  console.log(
    `LLM: ${isLlmEnabled() ? `${llmResult.provider || "configured"} generated=${llmResult.generated}` : "disabled"}`
  );

  const historyStats = await upsertSignalHistory(historyFilename, finalVerified);
  console.log(
    `Updated data/${historyFilename} ` +
    `(history=${historyStats.nextCount}, new=${historyStats.inserted})`
  );
}

main().catch((err) => {
  console.error("Verification failed:", err.message);
  process.exit(1);
});
