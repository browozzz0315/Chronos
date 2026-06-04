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

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function compactSignal(signal) {
  return {
    id: signal.id,
    openTime: signal.openTime,
    signalType: signal.signalType,
    strategy: signal.strategy,
    direction: signal.direction,
    outcome: signal.verification?.outcome,
    rMultiple: round(signal.verification?.rMultiple),
    pnlPct: round(signal.verification?.pnlPct),
    checkedBars: signal.verification?.checkedBars,
    marketState: signal.snapshot?.marketState,
    observationScore: signal.snapshot?.observationScore,
  };
}

function buildSummaryForReport(summary) {
  return Object.fromEntries(
    Object.entries(summary).map(([name, item]) => [
      name,
      {
        total: item.total,
        pending: item.pending || 0,
        wins: item.wins,
        losses: item.losses,
        winRate: item.winRate,
        avgR: item.avgR,
      },
    ])
  );
}

function createEmptyStats() {
  return {
    total: 0,
    pending: 0,
    wins: 0,
    losses: 0,
    totalR: 0,
    avgR: 0,
    winRate: 0,
  };
}

function addSignalToStats(stats, signal) {
  const outcome = signal.verification?.outcome;
  if (!outcome) return;

  if (outcome.startsWith("PENDING")) {
    stats.pending += 1;
    return;
  }

  stats.total += 1;
  stats.totalR += signal.verification?.rMultiple || 0;

  if (outcome.startsWith("WIN")) {
    stats.wins += 1;
  } else if (outcome === "LOSS") {
    stats.losses += 1;
  }
}

function finalizeStats(stats) {
  return {
    total: stats.total,
    pending: stats.pending,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.total ? round((stats.wins / stats.total) * 100) : 0,
    avgR: stats.total ? round(stats.totalR / stats.total) : 0,
  };
}

function buildObservationAnalysis(history) {
  const byDirection = {};
  const byMarketState = {};

  for (const signal of history) {
    if (signal.signalType !== "OBSERVATION") continue;

    const direction = signal.direction || "UNKNOWN";
    const marketState = signal.snapshot?.marketState || "UNKNOWN";

    if (!byDirection[direction]) byDirection[direction] = createEmptyStats();
    if (!byMarketState[marketState]) byMarketState[marketState] = createEmptyStats();

    addSignalToStats(byDirection[direction], signal);
    addSignalToStats(byMarketState[marketState], signal);
  }

  return {
    byDirection: Object.fromEntries(
      Object.entries(byDirection).map(([key, value]) => [key, finalizeStats(value)])
    ),
    byMarketState: Object.fromEntries(
      Object.entries(byMarketState)
        .sort(([, a], [, b]) => (b.total + b.pending) - (a.total + a.pending))
        .slice(0, envNumber("CHRONOS_REPORT_MARKET_STATES", 6))
        .map(([key, value]) => [key, finalizeStats(value)])
    ),
  };
}

function buildRecentSignals(history, limit = 4) {
  return [...history]
    .sort((a, b) => b.openTime - a.openTime)
    .slice(0, limit)
    .map(compactSignal);
}

function buildRepresentativeSignals(history, limit = 2) {
  const completed = history.filter((signal) => !signal.verification?.outcome?.startsWith("PENDING"));
  const pending = history.filter((signal) => signal.verification?.outcome?.startsWith("PENDING"));

  const best = [...completed]
    .sort((a, b) => (b.verification?.rMultiple ?? 0) - (a.verification?.rMultiple ?? 0))
    .slice(0, limit);

  const worst = [...completed]
    .sort((a, b) => (a.verification?.rMultiple ?? 0) - (b.verification?.rMultiple ?? 0))
    .slice(0, limit);

  const latestPending = [...pending]
    .sort((a, b) => b.openTime - a.openTime)
    .slice(0, limit);

  return [...best, ...worst, ...latestPending].map(compactSignal);
}

function buildFallbackReport(symbol, summary, recentSignals, asOf) {
  const lines = [`${symbol} 每日策略報告 (${asOf})`];

  if (!Object.keys(summary).length) {
    lines.push("目前尚無可用樣本，今日沒有可分析的策略結果。");
  } else {
    for (const [name, item] of Object.entries(summary)) {
      lines.push(
        `${name}：完成樣本 ${item.total} 筆，pending ${item.pending || 0} 筆，勝率 ${item.winRate}%，平均 R ${item.avgR}。`
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

function buildFallbackReportSafe(symbol, summary, recentSignals, representativeSignals, observationAnalysis, asOf) {
  const lines = [`${symbol} 每日策略報告 (${asOf})`];

  if (!Object.keys(summary).length) {
    lines.push("目前尚無可用樣本，今日沒有可分析的策略結果。");
  } else {
    for (const [name, item] of Object.entries(summary)) {
      lines.push(
        `${name}：完成樣本 ${item.total} 筆，pending ${item.pending || 0} 筆，勝率 ${item.winRate}%，平均 R ${item.avgR}。`
      );
    }
  }

  const obsDirections = observationAnalysis?.byDirection || {};
  for (const [direction, item] of Object.entries(obsDirections)) {
    lines.push(
      `OBS ${direction}：完成樣本 ${item.total} 筆，pending ${item.pending || 0} 筆，勝率 ${item.winRate}%，平均 R ${item.avgR}。`
    );
  }

  if (recentSignals.length) {
    const latest = recentSignals[0];
    lines.push(
      `最近一筆為 ${latest.strategy} ${latest.direction}，結果 ${latest.outcome || "PENDING"}，R=${latest.rMultiple ?? "n/a"}。`
    );
  }

  if (representativeSignals.length) {
    lines.push(`代表性樣本已納入 ${representativeSignals.length} 筆，用於檢查最好、最差與近期 pending 狀態。`);
  }

  lines.push("OBS 訊號用於看盤輔助與樣本累積，不等同正式交易建議。樣本仍少時請避免過度解讀。");
  return lines.join("\n");
}

async function main() {
  const symbols = parseSymbols(process.env.CHRONOS_SYMBOLS || process.argv[2]);
  const asOf = new Date().toISOString().slice(0, 10);

  for (const rawSymbol of symbols) {
    const symbol = normalizeSymbol(rawSymbol);
    const history = loadHistory(dataFilename(symbol, "1h_history"));
    const summary = buildSummaryForReport(summarize(history));
    const recentSignals = buildRecentSignals(
      history,
      envNumber("CHRONOS_REPORT_RECENT_SIGNALS", 4)
    );
    const representativeSignals = buildRepresentativeSignals(
      history,
      envNumber("CHRONOS_REPORT_REPRESENTATIVE_SIGNALS", 2)
    );
    const observationAnalysis = buildObservationAnalysis(history);

    let reportPayload = null;
    if (isLlmEnabled()) {
      reportPayload = await generateDailyReport({
        symbol,
        asOf,
        summary,
        recentSignals,
        representativeSignals,
        observationAnalysis,
      });
    }

    const reportText =
      reportPayload?.report ||
      buildFallbackReportSafe(
        symbol,
        summary,
        recentSignals,
        representativeSignals,
        observationAnalysis,
        asOf
      );

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
