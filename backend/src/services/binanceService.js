const axios = require("axios");

const BASE_URL = "https://api.binance.com";

async function fetchKlines({
  symbol = "BTCUSDT",
  interval = "1h",
  limit = 100,
}) {
  try {
    const response = await axios.get(
      `${BASE_URL}/api/v3/klines`,
      {
        params: {
          symbol,
          interval,
          limit,
        },
      }
    );

    return response.data.map((kline) => ({
      openTime: kline[0],
      open: kline[1],
      high: kline[2],
      low: kline[3],
      close: kline[4],
      volume: kline[5],
      closeTime: kline[6],
    }));
  } catch (error) {
    console.error("Failed to fetch klines:", error.message);
    throw error;
  }
}

module.exports = {
  fetchKlines,
};
