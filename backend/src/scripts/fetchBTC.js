const { fetchKlines } = require("../services/binanceService");
const { saveJson } = require("../utils/saveJson");

async function main() {
  try {
    const klines = await fetchKlines({
      symbol: "BTCUSDT",
      interval: "1h",
      limit: 100,
    });

    saveJson("btc_1h.json", klines);

    console.log("BTC Klines fetched successfully");
  } catch (error) {
    console.error(error);
  }
}

main();