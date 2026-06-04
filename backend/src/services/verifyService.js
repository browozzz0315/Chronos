/**
 * verifyService.js
 * Delayed verification system (Step 9).
 *
 * Logic:
 *   Given a signal with entry price, direction, and entry time,
 *   scan later candles and determine whether TP or SL is reached first.
 *
 * SL / TP levels:
 *   SL = 1.5 * ATR14 from the entry candle.
 *   TP1 = 1.5 * ATR, RR 1:1.
 *   TP2 = 3.0 * ATR, RR 1:2.
 *   TP3 = 4.5 * ATR, RR 1:3.
 *   ATR-based levels make results more comparable across symbols.
 */

// ─────────────────────────────────────────────
// Calculate stop-loss and take-profit levels after entry.
// ─────────────────────────────────────────────
function calcLevels(entryPrice, direction, atr) {
  const sl   = atr * 1.5;
  const tp1  = atr * 1.5;   // RR 1:1
  const tp2  = atr * 3.0;   // RR 1:2
  const tp3  = atr * 4.5;   // RR 1:3

  if (direction === "LONG") {
    return {
      sl:  parseFloat((entryPrice - sl).toFixed(2)),
      tp1: parseFloat((entryPrice + tp1).toFixed(2)),
      tp2: parseFloat((entryPrice + tp2).toFixed(2)),
      tp3: parseFloat((entryPrice + tp3).toFixed(2)),
      slDist: parseFloat(sl.toFixed(2)),
    };
  } else {
    return {
      sl:  parseFloat((entryPrice + sl).toFixed(2)),
      tp1: parseFloat((entryPrice - tp1).toFixed(2)),
      tp2: parseFloat((entryPrice - tp2).toFixed(2)),
      tp3: parseFloat((entryPrice - tp3).toFixed(2)),
      slDist: parseFloat(sl.toFixed(2)),
    };
  }
}

// ─────────────────────────────────────────────
// Verify a single signal.
// Inputs:
//   signal   - Signal object with openTime, entryPrice, and direction.
//   klines   - Full candle array with indicators.
//   maxBars  - Maximum candles to inspect before timeout, default 24.
// ─────────────────────────────────────────────
function verifySignal(signal, klines, maxBars = 24) {
  const { entryPrice, direction, openTime } = signal;

  // Locate the entry candle.
  const entryIndex = klines.findIndex((k) => k.openTime === openTime);
  if (entryIndex === -1) return { outcome: "NOT_FOUND" };

  // Use entry ATR; fall back to 0.8% of entry price if ATR is unavailable.
  const entryKline = klines[entryIndex];
  const atr = entryKline.indicators.atr14 ?? entryPrice * 0.008;

  const levels = calcLevels(entryPrice, direction, atr);

  // Scan candles after entry.
  let maxFavorable  = 0;   // Maximum favorable excursion.
  let maxAdverse    = 0;   // Maximum adverse excursion.
  let tp1Hit = false, tp2Hit = false, tp3Hit = false;
  let slHit  = false;
  let exitPrice    = null;
  let exitBar      = null;
  let exitReason   = null;

  const checkBars = Math.min(maxBars, klines.length - entryIndex - 1);
  const isCompleteWindow = checkBars >= maxBars;

  for (let i = 1; i <= checkBars; i++) {
    const bar = klines[entryIndex + i];
    if (!bar) break;

    const high  = bar.high;
    const low   = bar.low;
    const close = bar.close;

    if (direction === "LONG") {
      const favorable = high - entryPrice;
      const adverse   = entryPrice - low;
      if (favorable > maxFavorable) maxFavorable = favorable;
      if (adverse   > maxAdverse)   maxAdverse   = adverse;

      // Conservative rule: if SL and TP1 are both touched before TP1 is locked, count SL first.
      const slHitNow  = low  <= levels.sl;
      const tp1HitNow = high >= levels.tp1;

      if (slHitNow && !tp1Hit) {
        slHit = true; exitPrice = levels.sl;
        exitBar = i; exitReason = "SL"; break;
      }
      if (tp1HitNow && !tp1Hit) { tp1Hit = true; }
      if (tp1Hit && high >= levels.tp2) { tp2Hit = true; }
      if (tp2Hit && high >= levels.tp3) {
        tp3Hit = true; exitPrice = levels.tp3;
        exitBar = i; exitReason = "TP3"; break;
      }
    } else {
      // SHORT
      const favorable = entryPrice - low;
      const adverse   = high - entryPrice;
      if (favorable > maxFavorable) maxFavorable = favorable;
      if (adverse   > maxAdverse)   maxAdverse   = adverse;

      const slHitNow  = high >= levels.sl;
      const tp1HitNow = low  <= levels.tp1;

      if (slHitNow && !tp1Hit) {
        slHit = true; exitPrice = levels.sl;
        exitBar = i; exitReason = "SL"; break;
      }
      if (tp1HitNow && !tp1Hit) { tp1Hit = true; }
      if (tp1Hit && low <= levels.tp2) { tp2Hit = true; }
      if (tp2Hit && low <= levels.tp3) {
        tp3Hit = true; exitPrice = levels.tp3;
        exitBar = i; exitReason = "TP3"; break;
      }
    }
  }

  // Timeout or still-pending case when neither SL nor TP3 was reached.
  if (!slHit && !tp3Hit) {
    const lastBar = klines[entryIndex + checkBars];
    exitPrice  = lastBar?.close ?? entryPrice;
    exitBar = checkBars;
    exitReason = isCompleteWindow ? "TIMEOUT" : "PENDING";
  }

  // Calculate result metrics.
  const priceDiff = direction === "LONG"
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;

  const rMultiple = parseFloat((priceDiff / levels.slDist).toFixed(3)); // R multiple.
  const pnlPct    = parseFloat((priceDiff / entryPrice * 100).toFixed(3));

  // Outcome classification: TP1+ is a win, SL is a loss, incomplete windows are pending.
  let outcome;
  if (slHit)              outcome = "LOSS";
  else if (tp3Hit)        outcome = "WIN_TP3";
  else if (!isCompleteWindow && priceDiff > 0) outcome = "PENDING_PROFIT";
  else if (!isCompleteWindow) outcome = "PENDING_LOSS";
  else if (tp2Hit)        outcome = "WIN_TP2";
  else if (tp1Hit)        outcome = "WIN_TP1";
  else if (priceDiff > 0) outcome = "TIMEOUT_PROFIT";
  else                    outcome = "TIMEOUT_LOSS";

  return {
    outcome,
    exitPrice,
    exitReason,
    exitBar,         // Number of candles after entry.
    checkedBars: checkBars,
    isComplete: isCompleteWindow || slHit || tp3Hit,
    rMultiple,       // +2.1 means +2.1R; -1 means full stop loss.
    pnlPct,          // Percentage move without leverage.
    tp1Hit, tp2Hit, tp3Hit, slHit,
    mfe: parseFloat(maxFavorable.toFixed(2)),  // Maximum Favorable Excursion
    mae: parseFloat(maxAdverse.toFixed(2)),    // Maximum Adverse Excursion
    levels,
  };
}

// ─────────────────────────────────────────────
// Verify all signals in batch.
// ─────────────────────────────────────────────
function verifyAll(signals, klines, maxBars = 24) {
  return signals.map((sig) => {
    const result = verifySignal(sig, klines, maxBars);
    return { ...sig, verification: result };
  });
}

// ─────────────────────────────────────────────
// Build summary statistics for dashboard and logs.
// ─────────────────────────────────────────────
function summarize(verifiedSignals) {
  const byStrategy = {};

  for (const sig of verifiedSignals) {
    const { strategy, verification: v } = sig;
    if (!v || v.outcome === "NOT_FOUND") continue;

    if (!byStrategy[strategy]) {
      byStrategy[strategy] = {
        total: 0, wins: 0, losses: 0, timeouts: 0, pending: 0,
        totalR: 0, avgR: 0, winRate: 0,
      };
    }

    const s = byStrategy[strategy];
    if (v.outcome && v.outcome.startsWith("PENDING")) {
      s.pending++;
      continue;
    }

    s.total++;
    s.totalR += v.rMultiple;

    if (v.outcome.startsWith("WIN"))            s.wins++;
    else if (v.outcome === "LOSS")              s.losses++;
    else                                         s.timeouts++;
  }

  for (const s of Object.values(byStrategy)) {
    s.winRate = s.total > 0
      ? parseFloat(((s.wins / s.total) * 100).toFixed(1))
      : 0;
    s.avgR = s.total > 0
      ? parseFloat((s.totalR / s.total).toFixed(3))
      : 0;
  }

  return byStrategy;
}

module.exports = { verifySignal, verifyAll, summarize, calcLevels };
