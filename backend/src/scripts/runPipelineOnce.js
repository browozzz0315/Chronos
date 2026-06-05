const { runPipelines } = require("../services/pipelineService");
const { parseSymbols } = require("../utils/symbols");

const DISPLAY_TIMEZONE = process.env.CHRONOS_DISPLAY_TIMEZONE || "Asia/Taipei";

function formatMs(ms) {
  if (ms == null) return "n/a";
  const date = new Date(ms);
  return `${date.toISOString()} / ${date.toLocaleString("zh-TW", {
    timeZone: DISPLAY_TIMEZONE,
    hour12: false,
  })} ${DISPLAY_TIMEZONE}`;
}

async function main() {
  const symbols = parseSymbols(process.env.CHRONOS_SYMBOLS || process.argv[2]);

  console.log(`[pipeline] starting single run for ${symbols.join(",")}`);

  const results = await runPipelines(symbols);

  for (const result of results) {
    const strategyNames = Object.keys(result.summary);
    console.log(
      `[pipeline] ${result.symbol}: signals=${result.signals.length}, ` +
      `strategies=${strategyNames.length ? strategyNames.join(",") : "none"}, ` +
      `latestClosed1h=${formatMs(result.dataWindow?.latestCloseTime)}, ` +
      `history=${result.historyStats.nextCount}, pruned=${result.historyStats.pruned || 0}, ` +
      `llm=${result.llm.enabled ? `${result.llm.provider || "configured"} selected=${result.llm.selected} +${result.llm.generated}${result.llm.rateLimited ? " rate_limited" : ""}` : "disabled"}`
    );
  }

  console.log("[pipeline] single run finished");
}

main().catch((err) => {
  console.error("[pipeline] failed:", err.message);
  process.exit(1);
});
