const fs = require("fs");
const path = require("path");
const { generateDailyReport, isLlmEnabled } = require("../services/llmService");
const { summarize } = require("../services/verifyService");
const { loadHistory } = require("../utils/signalHistory");
const { dataFilename, parseSymbols, normalizeSymbol } = require("../utils/symbols");

const DATA_DIR = path.join(__dirname, "../../../data");

function saveText(filename, content) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`[report] Saved -> ${filePath}`);
}

function round(value) {
  return typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
}

function buildRecentSignals(history, limit = 5) {
  return [...history]
    .sort((a, b) => b.openTime - a.openTime)
    .slice(0, limit)
    .map((signal) => ({
      id: signal.id,
      openTime: signal.openTime,
      strategy: signal.strategy,
      direction: signal.direction,
      outcome: signal.verification?.outcome,
      rMultiple: round(signal.verification?.rMultiple),
      pnlPct: round(signal.verification?.pnlPct),
      marketState: signal.snapshot?.marketState,
    }));
}

function buildFallbackReport(symbol, summary, recentSignals, asOf) {
  const lines = [`${symbol} 每日策略報告 (${asOf})`];

  if (!Object.keys(summary).length) {
    lines.push("目前尚無可用樣本，今日沒有可分析的策略結果。");
  } else {
    for (const [name, item] of Object.entries(summary)) {
      lines.push(
        `${name}：樣本 ${item.total} 筆，勝率 ${item.winRate}%，平均 R ${item.avgR}。`
      );
    }
  }

  if (recentSignals.length) {
    const latest = recentSignals[0];
    lines.push(
      `最近一筆為 ${latest.strategy} ${latest.direction}，結果 ${latest.outcome || "PENDING"}，R=${latest.rMultiple ?? "n/a"}。`
    );
  }

  lines.push("若樣本仍少於 50 筆，請避免過度解讀短期勝率。");
  return lines.join("\n");
}

async function main() {
  const symbols = parseSymbols(process.env.CHRONOS_SYMBOLS || process.argv[2]);
  const asOf = new Date().toISOString().slice(0, 10);

  for (const rawSymbol of symbols) {
    const symbol = normalizeSymbol(rawSymbol);
    const history = loadHistory(dataFilename(symbol, "1h_history"));
    const summary = summarize(history);
    const recentSignals = buildRecentSignals(history, 6);

    let reportPayload = null;
    if (isLlmEnabled()) {
      reportPayload = await generateDailyReport({
        symbol,
        asOf,
        summary,
        recentSignals,
      });
    }

    const reportText =
      reportPayload?.report ||
      buildFallbackReport(symbol, summary, recentSignals, asOf);

    const markdown = [
      `# ${symbol} Daily Report`,
      "",
      `- Date: ${asOf}`,
      `- Provider: ${reportPayload?.provider || "local-fallback"}`,
      `- Model: ${reportPayload?.model || "n/a"}`,
      "",
      reportText,
      "",
    ].join("\n");

    saveText(`${symbol.toLowerCase()}_daily_report.md`, markdown);
  }
}

main().catch((err) => {
  console.error("[report] failed:", err.message);
  process.exit(1);
});
