const fs = require("fs");
const path = require("path");
const { generateSignals } = require("../services/signalService");
const { verifyAll, summarize } = require("../services/verifyService");
const { saveJson } = require("../utils/saveJson");

function loadData(filename) {
  const filePath = path.join(__dirname, "../../../data", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing data file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
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

  const klines = loadData("btc_1h.json");
  const signals = generateSignals(klines);
  const verified = verifyAll(signals, klines, 24);
  const summary = summarize(verified);

  console.log(`Loaded ${klines.length} candles`);
  console.log(`Range: ${formatTime(klines[0].openTime)} -> ${formatTime(klines[klines.length - 1].openTime)}`);
  console.log(`Signals: ${signals.length}`);

  printDivider("Verification results");
  for (const sig of verified) {
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

  await saveJson("btc_1h_verified.json", verified);
  console.log("Saved data/btc_1h_verified.json");
}

main().catch((err) => {
  console.error("Verification failed:", err.message);
  process.exit(1);
});
