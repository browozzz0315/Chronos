const cron = require("node-cron");
const { runPipeline } = require("../services/pipelineService");

const CRON_SCHEDULE = process.env.CHRONOS_CRON_SCHEDULE || "0 * * * *";
const SYMBOL = process.env.CHRONOS_SYMBOL || "BTCUSDT";

async function runCycle(trigger = "manual") {
  const startedAt = new Date();
  console.log(`[cron] ${trigger} cycle started at ${startedAt.toISOString()}`);

  try {
    const result = await runPipeline(SYMBOL);
    const strategyNames = Object.keys(result.summary);
    console.log(
      `[cron] cycle finished: signals=${result.signals.length}, ` +
      `strategies=${strategyNames.length ? strategyNames.join(",") : "none"}`
    );
  } catch (err) {
    console.error(`[cron] cycle failed: ${err.message}`);
  }
}

cron.schedule(CRON_SCHEDULE, () => {
  void runCycle("scheduled");
});

console.log(`[cron] scheduler active for ${SYMBOL} with schedule "${CRON_SCHEDULE}"`);
void runCycle("startup");
