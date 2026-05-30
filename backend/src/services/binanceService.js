const axios = require("axios");

const BASE_URL = "https://api.binance.com";

/**
 * 抓取 K 線資料
 * @param {string} symbol  - 交易對，例如 "BTCUSDT"
 * @param {string} interval - 時間框架 "1h" | "4h" | "1d"
 * @param {number} limit    - 根數，最大 1000，EMA200 建議 >= 300
 */
async function fetchKlines({ symbol = "BTCUSDT", interval = "1h", limit = 300 }) {
  try {
    const response = await axios.get(`${BASE_URL}/api/v3/klines`, {
      params: { symbol, interval, limit },
      timeout: 10000,
    });

    return response.data.map((k) => ({
      openTime:     k[0],                    // ms timestamp
      open:         parseFloat(k[1]),         // ✅ 修正：String → Float
      high:         parseFloat(k[2]),
      low:          parseFloat(k[3]),
      close:        parseFloat(k[4]),
      volume:       parseFloat(k[5]),
      closeTime:    k[6],
      quoteVolume:  parseFloat(k[7]),         // ✅ 新增：USDT 成交量（比 BTC 量更直觀）
      trades:       k[8],                     // ✅ 新增：成交筆數，用於量能確認
    }));
  } catch (error) {
    console.error(`[binanceService] fetchKlines failed (${symbol} ${interval}):`, error.message);
    throw error;
  }
}

/**
 * 一次抓多個時間框架（BTC / ETH 通用）
 * @param {string} symbol
 * @returns {{ "1h": [...], "4h": [...], "1d": [...] }}
 */
async function fetchMultiTimeframe(symbol = "BTCUSDT") {
  const configs = [
    { interval: "1h",  limit: 300 },   // 300根 1h ≈ 12天，EMA200 夠用
    { interval: "4h",  limit: 200 },   // 200根 4h ≈ 33天
    { interval: "1d",  limit: 200 },   // 200根 1d ≈ 200天，長期趨勢
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