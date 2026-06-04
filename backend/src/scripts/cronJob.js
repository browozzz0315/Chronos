const cron = require("node-cron");
const { runPipelines } = require("../services/pipelineService");
const { parseSymbols } = require("../utils/symbols");

const CRON_SCHEDULE = process.env.CHRONOS_CRON_SCHEDULE || "2 * * * *";
const CRON_TIMEZONE = process.env.CHRONOS_CRON_TIMEZONE || "Asia/Taipei";
const SYMBOLS = parseSymbols(process.env.CHRONOS_SYMBOLS || process.env.CHRONOS_SYMBOL);
const RUN_ON_STARTUP = process.env.CHRONOS_RUN_ON_STARTUP !== "false";
let isRunning = false;

function formatTime(date) {
  return `${date.toISOString()} / ${date.toLocaleString("zh-TW", {
    timeZone: CRON_TIMEZONE,
    hour12: false,
  })} ${CRON_TIMEZONE}`;
}

function formatMs(ms) {
  if (ms == null) return "n/a";
  return formatTime(new Date(ms));
}

async function runCycle(trigger = "manual") {
  if (isRunning) {
    console.warn(`[cron] ${trigger} cycle skipped because previous cycle is still running`);
    return;
  }

  isRunning = true;
  const startedAt = new Date();
  console.log(`[cron] ${trigger} cycle started at ${formatTime(startedAt)}`);

  try {
    const results = await runPipelines(SYMBOLS);

    for (const result of results) {
      const strategyNames = Object.keys(result.summary);
      console.log(
        `[cron] ${result.symbol}: signals=${result.signals.length}, ` +
        `strategies=${strategyNames.length ? strategyNames.join(",") : "none"}, ` +
        `latestClosed1h=${formatMs(result.dataWindow?.latestCloseTime)}, ` +
        `history=${result.historyStats.nextCount}, ` +
        `llm=${result.llm.enabled ? `${result.llm.provider || "configured"} selected=${result.llm.selected} +${result.llm.generated}${result.llm.rateLimited ? " rate_limited" : ""}` : "disabled"}`
      );
    }

    const finishedAt = new Date();
    console.log(
      `[cron] cycle finished for ${results.length} symbols at ${formatTime(finishedAt)} ` +
      `(duration=${Math.round((finishedAt - startedAt) / 1000)}s)`
    );
  } catch (err) {
    console.error(`[cron] cycle failed: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

cron.schedule(CRON_SCHEDULE, () => {
  void runCycle("scheduled");
}, {
  timezone: CRON_TIMEZONE,
});

console.log(
  `[cron] scheduler active for ${SYMBOLS.join(",")} with schedule "${CRON_SCHEDULE}" ` +
  `timezone=${CRON_TIMEZONE}`
);
if (RUN_ON_STARTUP) {
  void runCycle("startup");
}
