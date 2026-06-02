/**
 * signalService.js
 * 規則型訊號產生器（Step 8）
 *
 * 設計原則：
 * - 每個策略都是獨立函式，方便日後個別驗證勝率
 * - 每個訊號記錄「觸發條件快照」，延遲驗證時才知道當時為什麼進場
 * - EMA200 若為 null（資料不足）會自動 skip，不產生假訊號
 * - Step 11.5 起加入訊號品質控管，避免同一段趨勢每根 K 都重複出訊號
 */

// 訊號品質控管預設值，可在 generateSignals(klines, options) 傳入覆蓋。
const DEFAULT_SIGNAL_OPTIONS = {
  symbol: "BTCUSDT",
  cooldownBars: 6,                // 同策略同方向至少間隔 N 根 K 才能再次出訊號
  requireTrendTransition: true,   // 趨勢策略只在條件剛從 false 變 true 時進場
};

// 技術指標可能是 null / undefined，統一用這個 helper 判斷可用數值。
function hasNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function allConditionsPassed(conditions) {
  return Object.values(conditions).every(Boolean);
}

// 輔助：計算最近 N 根的平均成交量。
function avgVolume(klines, index, period = 20) {
  if (index < period) return null;
  const slice = klines.slice(index - period, index);
  return slice.reduce((sum, k) => sum + k.volume, 0) / period;
}

// ─────────────────────────────────────────────────────
// 策略 A：趨勢順勢做多
// 條件：
//   1. EMA20 > EMA50 > EMA200（多頭排列）
//   2. RSI 在 45~65（不追高，動能健康）
//   3. 收盤在 EMA20 上方（不在均線下方追多）
//   4. MACD 柱狀圖為正（動能方向確認）
//   5. ADX >= 20 或 ADX 尚不可用
// 適合：趨勢盤做順勢回踩。
// ─────────────────────────────────────────────────────
function strategyTrendLong(kline) {
  const { close } = kline;
  const { ema20, ema50, ema200, rsi14, macdHist, adx } = kline.indicators || {};

  if (
    !hasNumber(close) ||
    !hasNumber(ema20) ||
    !hasNumber(ema50) ||
    !hasNumber(ema200) ||
    !hasNumber(rsi14) ||
    !hasNumber(macdHist)
  ) {
    return null;
  }

  const conditions = {
    ema_alignment: ema20 > ema50 && ema50 > ema200,  // 多頭排列
    rsi_healthy: rsi14 >= 45 && rsi14 <= 65,         // 動能健康區間
    price_above_ema: close > ema20,                  // 收盤在 EMA20 上方
    macd_positive: macdHist > 0,                     // 動能向上
    adx_trending: !hasNumber(adx) || adx >= 20,      // 有趨勢；ADX 不足時先放行
  };

  if (!allConditionsPassed(conditions)) return null;

  return {
    strategy: "TREND_LONG",
    direction: "LONG",
    conditions,
    snapshot: { close, ema20, ema50, ema200, rsi14, macdHist, adx },
  };
}

// ─────────────────────────────────────────────────────
// 策略 B：超賣反彈做多
// 條件：
//   1. RSI < 30（超賣）
//   2. 當根成交量 > 20 期均量的 1.3 倍（量能放大，有人在接）
//   3. 收盤在 EMA200 上方（大趨勢仍偏多，不做逆勢反彈）
//   4. 前一根也是下跌（確認是在跌勢中超賣）
// 適合：回調過深後的短反彈。
// ─────────────────────────────────────────────────────
function strategyOversoldBounce(kline, index, allKlines) {
  const { close, volume } = kline;
  const { rsi14, ema200 } = kline.indicators || {};

  if (!hasNumber(close) || !hasNumber(volume) || !hasNumber(rsi14) || !hasNumber(ema200) || index < 1) {
    return null;
  }

  const avgVol = avgVolume(allKlines, index, 20);
  const prevKline = allKlines[index - 1];

  if (!avgVol || !prevKline) return null;

  const conditions = {
    rsi_oversold: rsi14 < 30,                         // 超賣
    volume_surge: volume > avgVol * 1.3,              // 成交量放大
    above_ema200: close > ema200,                     // 大趨勢偏多
    prev_was_bearish: prevKline.close < prevKline.open, // 前一根收陰線
  };

  if (!allConditionsPassed(conditions)) return null;

  return {
    strategy: "OVERSOLD_BOUNCE",
    direction: "LONG",
    conditions,
    snapshot: { close, volume, avgVol: Math.round(avgVol), rsi14, ema200 },
  };
}

// ─────────────────────────────────────────────────────
// 策略 C：趨勢順勢做空
// 策略 A 的鏡像版本
// 條件：
//   1. EMA20 < EMA50 < EMA200（空頭排列）
//   2. RSI 在 35~55（不追空，動能健康偏空）
//   3. 收盤在 EMA20 下方
//   4. MACD 柱狀圖為負
//   5. ADX >= 20 或 ADX 尚不可用
// ─────────────────────────────────────────────────────
function strategyTrendShort(kline) {
  const { close } = kline;
  const { ema20, ema50, ema200, rsi14, macdHist, adx } = kline.indicators || {};

  if (
    !hasNumber(close) ||
    !hasNumber(ema20) ||
    !hasNumber(ema50) ||
    !hasNumber(ema200) ||
    !hasNumber(rsi14) ||
    !hasNumber(macdHist)
  ) {
    return null;
  }

  const conditions = {
    ema_alignment: ema20 < ema50 && ema50 < ema200,  // 空頭排列
    rsi_healthy: rsi14 >= 35 && rsi14 <= 55,         // 動能健康偏空區間
    price_below_ema: close < ema20,                  // 收盤在 EMA20 下方
    macd_negative: macdHist < 0,                     // 動能向下
    adx_trending: !hasNumber(adx) || adx >= 20,      // 有趨勢；ADX 不足時先放行
  };

  if (!allConditionsPassed(conditions)) return null;

  return {
    strategy: "TREND_SHORT",
    direction: "SHORT",
    conditions,
    snapshot: { close, ema20, ema50, ema200, rsi14, macdHist, adx },
  };
}

// 趨勢策略需要 transition filter；反彈策略本身較像事件型訊號，暫不套用。
function isTrendStrategy(strategyName) {
  return strategyName === "TREND_LONG" || strategyName === "TREND_SHORT";
}

// 組合最終 signal 格式，保留 conditions / snapshot / quality 供 Dashboard 與驗證使用。
function buildSignal(result, kline, options, quality) {
  return {
    id: `${result.strategy}_${kline.openTime}`,
    openTime: kline.openTime,
    symbol: options.symbol,
    entryPrice: kline.close,
    ...result,
    quality,
    verifiedAt: null,
    outcome: null,
  };
}

// ─────────────────────────────────────────────────────
// 主入口：對整批 K 線跑所有策略
// 回傳所有觸發的訊號（一根 K 線可能觸發多個策略）
//
// 品質控管：
// - cooldown：同策略同方向若距離上一筆太近，直接跳過
// - trend transition：TREND_LONG / TREND_SHORT 只在條件剛成立時進場
// ─────────────────────────────────────────────────────
function generateSignals(klines, options = {}) {
  const mergedOptions = { ...DEFAULT_SIGNAL_OPTIONS, ...options };
  const strategies = [
    strategyTrendLong,
    strategyOversoldBounce,
    strategyTrendShort,
  ];

  const signals = [];
  const lastSignalIndex = new Map();

  for (let i = 1; i < klines.length; i++) {
    const kline = klines[i];

    for (const strategy of strategies) {
      const result = strategy(kline, i, klines);
      if (!result) continue;

      const signalKey = `${result.strategy}:${result.direction}`;
      const previousSignalIndex = lastSignalIndex.get(signalKey);
      const barsSinceLastSignal = previousSignalIndex == null
        ? null
        : i - previousSignalIndex;

      // 避免同一段趨勢中每根 K 都重複出同方向訊號。
      if (
        barsSinceLastSignal != null &&
        barsSinceLastSignal < mergedOptions.cooldownBars
      ) {
        continue;
      }

      let passedTransitionFilter = true;
      if (mergedOptions.requireTrendTransition && isTrendStrategy(result.strategy)) {
        // 只有「上一根未成立、這一根成立」才視為新的趨勢進場點。
        const previousResult = strategy(klines[i - 1], i - 1, klines);
        passedTransitionFilter = previousResult === null;
      }

      if (!passedTransitionFilter) continue;

      const quality = {
        cooldownBars: mergedOptions.cooldownBars,
        barsSinceLastSignal,
        transitionEntry: isTrendStrategy(result.strategy),
      };

      signals.push(buildSignal(result, kline, mergedOptions, quality));
      lastSignalIndex.set(signalKey, i);
    }
  }

  return signals;
}

module.exports = {
  generateSignals,
  strategyTrendLong,
  strategyOversoldBounce,
  strategyTrendShort,
};
