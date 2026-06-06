/**
 * signalService.js
 * Rule-based signal generator (Step 8).
 *
 * Design notes:
 * - Each strategy is an isolated function so win rate can be reviewed separately.
 * - Each signal stores its trigger conditions and indicator snapshot for delayed verification.
 * - EMA200 can be null during warm-up; incomplete rows are skipped to avoid false signals.
 * - Signal quality controls prevent repeated entries on every candle in the same trend leg.
 */

// Default quality controls; callers can override them through generateSignals(klines, options).
const DEFAULT_SIGNAL_OPTIONS = {
  symbol: "BTCUSDT",
  cooldownBars: 6,                // Same strategy and direction must wait N candles before firing again.
  requireTrendTransition: true,   // Trend strategies only fire when conditions just changed from false to true.
  includeContinuationSignals: true, // Watchlist helper: mark candles where an existing trend setup remains valid.
  includeObservationSignals: true, // Watchlist helper: produce directional observations on closed candles.
  observationMinScore: 2,          // Minimum absolute score required for an OBS_BIAS signal.
};

// Indicators can be null or undefined; use one helper for valid numeric checks.
function hasNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function allConditionsPassed(conditions) {
  return Object.values(conditions).every(Boolean);
}

function directionScoreLabel(score) {
  if (score > 0) return "LONG";
  if (score < 0) return "SHORT";
  return "NEUTRAL";
}

// Observation signal: vote across common momentum/trend conditions.
// This is not a strict trade setup; it creates verifiable watchlist samples per candle.
function strategyObservationBias(kline, index, allKlines, options = {}) {
  const { close } = kline;
  const { ema20, ema50, ema200, rsi14, macdHist, adx, marketState } = kline.indicators || {};

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

  const votes = {
    price_vs_ema20: close >= ema20 ? 1 : -1,
    ema20_vs_ema50: ema20 >= ema50 ? 1 : -1,
    ema50_vs_ema200: ema50 >= ema200 ? 1 : -1,
    macd_hist: macdHist >= 0 ? 1 : -1,
    rsi_zone: rsi14 >= 55 ? 1 : rsi14 <= 45 ? -1 : 0,
  };

  let score = Object.values(votes).reduce((sum, value) => sum + value, 0);
  if (hasNumber(adx) && adx >= 20 && score !== 0) {
    score += score > 0 ? 1 : -1;
  }

  const minScore = options.observationMinScore ?? DEFAULT_SIGNAL_OPTIONS.observationMinScore;
  if (Math.abs(score) < minScore) return null;

  const direction = directionScoreLabel(score);

  return {
    strategy: `OBS_BIAS_${direction}`,
    direction,
    signalType: "OBSERVATION",
    conditions: {
      enough_directional_score: Math.abs(score) >= minScore,
      price_above_ema20: close >= ema20,
      ema20_above_ema50: ema20 >= ema50,
      ema50_above_ema200: ema50 >= ema200,
      macd_positive: macdHist >= 0,
      rsi_bullish: rsi14 >= 55,
      rsi_bearish: rsi14 <= 45,
      adx_trending: hasNumber(adx) ? adx >= 20 : null,
    },
    snapshot: {
      close,
      ema20,
      ema50,
      ema200,
      rsi14,
      macdHist,
      adx,
      marketState,
      observationScore: score,
      observationVotes: votes,
    },
  };
}

// Helper: average volume over the previous N candles.
function avgVolume(klines, index, period = 20) {
  if (index < period) return null;
  const slice = klines.slice(index - period, index);
  return slice.reduce((sum, k) => sum + k.volume, 0) / period;
}

// ─────────────────────────────────────────────────────
// Strategy A: trend-following long.
// Conditions:
//   1. EMA20 > EMA50 > EMA200.
//   2. RSI between 45 and 65, avoiding overextended entries.
//   3. Close above EMA20.
//   4. MACD histogram is positive.
//   5. ADX >= 20, or ADX is not available yet.
// Best used for pullback entries during an uptrend.
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
    ema_alignment: ema20 > ema50 && ema50 > ema200,  // Bullish EMA alignment.
    rsi_healthy: rsi14 >= 45 && rsi14 <= 65,         // Healthy momentum zone.
    price_above_ema: close > ema20,                  // Close above EMA20.
    macd_positive: macdHist > 0,                     // Upward momentum.
    adx_trending: !hasNumber(adx) || adx >= 20,      // Allow rows where ADX is still warming up.
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
// Strategy B: oversold bounce long.
// Conditions:
//   1. RSI < 30.
//   2. Current volume is greater than 1.3x the 20-candle average.
//   3. Close remains above EMA200 to avoid counter-trend bounce attempts.
//   4. Previous candle is bearish, confirming an oversold pullback.
// Best used for short rebounds after deep pullbacks.
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
    rsi_oversold: rsi14 < 30,                         // Oversold.
    volume_surge: volume > avgVol * 1.3,              // Volume expansion.
    above_ema200: close > ema200,                     // Major trend remains bullish.
    prev_was_bearish: prevKline.close < prevKline.open, // Previous candle closed bearish.
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
// Strategy C: trend-following short.
// Mirror version of Strategy A.
// Conditions:
//   1. EMA20 < EMA50 < EMA200.
//   2. RSI between 35 and 55, avoiding overextended shorts.
//   3. Close below EMA20.
//   4. MACD histogram is negative.
//   5. ADX >= 20, or ADX is not available yet.
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
    ema_alignment: ema20 < ema50 && ema50 < ema200,  // Bearish EMA alignment.
    rsi_healthy: rsi14 >= 35 && rsi14 <= 55,         // Healthy bearish momentum zone.
    price_below_ema: close < ema20,                  // Close below EMA20.
    macd_negative: macdHist < 0,                     // Downward momentum.
    adx_trending: !hasNumber(adx) || adx >= 20,      // Allow rows where ADX is still warming up.
  };

  if (!allConditionsPassed(conditions)) return null;

  return {
    strategy: "TREND_SHORT",
    direction: "SHORT",
    conditions,
    snapshot: { close, ema20, ema50, ema200, rsi14, macdHist, adx },
  };
}

// Trend strategies use a transition filter; bounce setups are event-like and do not use it.
function isTrendStrategy(strategyName) {
  return strategyName === "TREND_LONG" || strategyName === "TREND_SHORT";
}

function strategyTrendContinuation(kline, index, allKlines) {
  if (index < 1) return null;

  const trendStrategies = [strategyTrendLong, strategyTrendShort];

  for (const strategy of trendStrategies) {
    const current = strategy(kline, index, allKlines);
    if (!current) continue;

    const previous = strategy(allKlines[index - 1], index - 1, allKlines);
    if (!previous) continue;

    return {
      ...current,
      strategy: `${current.strategy}_CONTINUATION`,
      signalType: "CONTINUATION",
      conditions: {
        ...current.conditions,
        previous_candle_also_valid: true,
      },
      snapshot: {
        ...current.snapshot,
        sourceStrategy: current.strategy,
      },
    };
  }

  return null;
}

// Build the final signal shape and keep conditions / snapshot / quality for dashboard and verification.
function buildSignal(result, kline, options, quality) {
  return {
    id: `${result.strategy}_${kline.openTime}`,
    openTime: kline.openTime,
    symbol: options.symbol,
    entryPrice: kline.close,
    signalType: result.signalType || "TRADE",
    ...result,
    quality,
    verifiedAt: null,
    outcome: null,
  };
}

// ─────────────────────────────────────────────────────
// Main entry: run all strategies against a full candle batch.
// A single candle can trigger multiple strategies.
//
// Quality controls:
// - cooldown: skip same-strategy same-direction signals that are too close together.
// - trend transition: TREND_LONG / TREND_SHORT only fire when the setup has just become valid.
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

      // Avoid repeated same-direction signals on every candle within one trend leg.
      if (
        barsSinceLastSignal != null &&
        barsSinceLastSignal < mergedOptions.cooldownBars
      ) {
        continue;
      }

      let passedTransitionFilter = true;
      if (mergedOptions.requireTrendTransition && isTrendStrategy(result.strategy)) {
        // Only a false-to-true transition is treated as a new trend entry point.
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

    if (mergedOptions.includeContinuationSignals) {
      const continuation = strategyTrendContinuation(kline, i, klines);
      if (continuation) {
        signals.push(buildSignal(continuation, kline, mergedOptions, {
          signalType: "CONTINUATION",
          sourceStrategy: continuation.snapshot.sourceStrategy,
        }));
      }
    }

    if (mergedOptions.includeObservationSignals) {
      const observation = strategyObservationBias(kline, i, klines, mergedOptions);
      if (observation) {
        signals.push(buildSignal(observation, kline, mergedOptions, {
          signalType: "OBSERVATION",
          observationMinScore: mergedOptions.observationMinScore,
          observationScore: observation.snapshot.observationScore,
        }));
      }
    }
  }

  return signals;
}

module.exports = {
  generateSignals,
  strategyObservationBias,
  strategyTrendContinuation,
  strategyTrendLong,
  strategyOversoldBounce,
  strategyTrendShort,
};
