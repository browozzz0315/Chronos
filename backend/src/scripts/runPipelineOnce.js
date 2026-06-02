const { runPipelines } = require("../services/pipelineService");
const { parseSymbols } = require("../utils/symbols");

async function main() {
  const symbols = parseSymbols(process.env.CHRONOS_SYMBOLS || process.argv[2]);

  console.log(`[pipeline] starting single run for ${symbols.join(",")}`);

  const results = await runPipelines(symbols);

  for (const result of results) {
    const strategyNames = Object.keys(result.summary);
    console.log(
      `[pipeline] ${result.symbol}: signals=${result.signals.length}, ` +
      `strategies=${strategyNames.length ? strategyNames.join(",") : "none"}`
    );
  }

  console.log("[pipeline] single run finished");
}

main().catch((err) => {
  console.error("[pipeline] failed:", err.message);
  process.exit(1);
});
