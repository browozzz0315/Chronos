const axios = require("axios");

const BASE_URL = "https://api.binance.com";

/**
 * Fetch candlestick data.
 * @param {string} symbol - Trading pair, e.g. "BTCUSDT".
 * @param {string} interval - Timeframe: "1h" | "4h" | "1d".
 * @param {number} limit - Number of candles, max 1000; EMA200 should use >= 300.
 */
async function fetchKlines({ symbol = "BTCUSDT", interval = "1h", limit = 300 }) {
  try {
    const response = await axios.get(`${BASE_URL}/api/v3/klines`, {
      params: { symbol, interval, limit },
      timeout: 10000,
    });

    return response.data.map((k) => ({
      openTime:     k[0],                    // ms timestamp
      open:         parseFloat(k[1]),         // Binance returns strings; store numeric OHLCV.
      high:         parseFloat(k[2]),
      low:          parseFloat(k[3]),
      close:        parseFloat(k[4]),
      volume:       parseFloat(k[5]),
      closeTime:    k[6],
      quoteVolume:  parseFloat(k[7]),         // Quote volume is more intuitive for USDT pairs.
      trades:       k[8],                     // Trade count can help future volume confirmation.
    }));
  } catch (error) {
    console.error(`[binanceService] fetchKlines failed (${symbol} ${interval}):`, error.message);
    throw error;
  }
}

/**
 * Fetch all supported timeframes for one symbol.
 * @param {string} symbol
 * @returns {{ "1h": [...], "4h": [...], "1d": [...] }}
 */
async function fetchMultiTimeframe(symbol = "BTCUSDT") {
  const configs = [
    { interval: "1h",  limit: 300 },   // About 12 days; enough warm-up for EMA200.
    { interval: "4h",  limit: 200 },   // About 33 days.
    { interval: "1d",  limit: 200 },   // About 200 days for long-term context.
  ];

  const results = await Promise.all(
    configs.map(({ interval, limit }) =>
      fetchKlines({ symbol, interval, limit })
    )
  );

  return {
    "1h":  results[0],
    "4h":  results[1],
    "1d":  results[2],
  };
}

module.exports = { fetchKlines, fetchMultiTimeframe };
