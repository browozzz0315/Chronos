const cron = require("node-cron");
const { runPipelines } = require("../services/pipelineService");
const { parseSymbols } = require("../utils/symbols");

const CRON_SCHEDULE = process.env.CHRONOS_CRON_SCHEDULE || "0 * * * *";
const SYMBOLS = parseSymbols(process.env.CHRONOS_SYMBOLS || process.env.CHRONOS_SYMBOL);

async function runCycle(trigger = "manual") {
  const startedAt = new Date();
  console.log(`[cron] ${trigger} cycle started at ${startedAt.toISOString()}`);

  try {
    const results = await runPipelines(SYMBOLS);

    for (const result of results) {
      const strategyNames = Object.keys(result.summary);
      console.log(
        `[cron] ${result.symbol}: signals=${result.signals.length}, ` +
        `strategies=${strategyNames.length ? strategyNames.join(",") : "none"}`
      );
    }

    console.log(`[cron] cycle finished for ${results.length} symbols`);
  } catch (err) {
    console.error(`[cron] cycle failed: ${err.message}`);
  }
}

cron.schedule(CRON_SCHEDULE, () => {
  void runCycle("scheduled");
});

console.log(`[cron] scheduler active for ${SYMBOLS.join(",")} with schedule "${CRON_SCHEDULE}"`);
void runCycle("startup");
