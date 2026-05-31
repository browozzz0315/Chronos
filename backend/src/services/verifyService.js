/**
 * verifyService.js
 * 延遲驗證系統（Step 9）
 *
 * 邏輯：
 *   給定一個訊號（含進場價、方向、進場時間）
 *   從進場後的 K 線逐根掃描，判斷是否先碰到 TP 或 SL
 *
 * SL / TP 計算方式：
 *   SL = 1.5 × ATR14（進場當根的 ATR）
 *   TP1 = 1.5 × ATR（RR 1:1）
 *   TP2 = 3.0 × ATR（RR 1:2）
 *   TP3 = 4.5 × ATR（RR 1:3）
 *   使用 ATR 倍數而非固定點數，不同幣種結果才能互相比較
 */

// ─────────────────────────────────────────────
// 計算進場後的止盈止損價位
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
// 單筆訊號驗證
// 輸入：
//   signal   - 訊號物件（含 openTime, entryPrice, direction）
//   klines   - 完整 K 線陣列（含 indicators）
//   maxBars  - 最多看幾根後就算逾時（預設 24 根 = 24h）
// ─────────────────────────────────────────────
function verifySignal(signal, klines, maxBars = 24) {
  const { entryPrice, direction, openTime } = signal;

  // 找進場 K 線的 index
  const entryIndex = klines.findIndex((k) => k.openTime === openTime);
  if (entryIndex === -1) return { outcome: "NOT_FOUND" };

  // 取進場當根的 ATR（若 null 則用收盤價的 0.8% 估算）
  const entryKline = klines[entryIndex];
  const atr = entryKline.indicators.atr14 ?? entryPrice * 0.008;

  const levels = calcLevels(entryPrice, direction, atr);

  // 逐根掃描進場後的 K 線
  let maxFavorable  = 0;   // 最大有利浮動（用來算 MFE）
  let maxAdverse    = 0;   // 最大不利浮動（用來算 MAE）
  let tp1Hit = false, tp2Hit = false, tp3Hit = false;
  let slHit  = false;
  let exitPrice    = null;
  let exitBar      = null;
  let exitReason   = null;

  const checkBars = Math.min(maxBars, klines.length - entryIndex - 1);

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

      // 先判斷同一根內是否同時碰到 SL 和 TP（用開盤方向判斷誰先）
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

  // 逾時（maxBars 內沒碰到 SL 或 TP3）
  if (!slHit && !tp3Hit) {
    const lastBar = klines[entryIndex + checkBars];
    exitPrice  = lastBar?.close ?? entryPrice;
    exitReason = "TIMEOUT";
  }

  // 計算結果
  const priceDiff = direction === "LONG"
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;

  const rMultiple = parseFloat((priceDiff / levels.slDist).toFixed(3)); // R 倍數
  const pnlPct    = parseFloat((priceDiff / entryPrice * 100).toFixed(3));

  // 勝負判斷：碰到 TP1 以上算贏，SL 或 TIMEOUT 且虧損算輸
  let outcome;
  if (slHit)              outcome = "LOSS";
  else if (tp3Hit)        outcome = "WIN_TP3";
  else if (tp2Hit)        outcome = "WIN_TP2";
  else if (tp1Hit)        outcome = "WIN_TP1";
  else if (priceDiff > 0) outcome = "TIMEOUT_PROFIT";
  else                    outcome = "TIMEOUT_LOSS";

  return {
    outcome,
    exitPrice,
    exitReason,
    exitBar,         // 第幾根後出場
    rMultiple,       // +2.1 代表賺了 2.1R，-1 代表完整止損
    pnlPct,          // 不含槓桿的百分比
    tp1Hit, tp2Hit, tp3Hit, slHit,
    mfe: parseFloat(maxFavorable.toFixed(2)),  // Maximum Favorable Excursion
    mae: parseFloat(maxAdverse.toFixed(2)),    // Maximum Adverse Excursion
    levels,
  };
}

// ─────────────────────────────────────────────
// 批次驗證所有訊號
// ─────────────────────────────────────────────
function verifyAll(signals, klines, maxBars = 24) {
  return signals.map((sig) => {
    const result = verifySignal(sig, klines, maxBars);
    return { ...sig, verification: result };
  });
}

// ─────────────────────────────────────────────
// 統計摘要（給 Dashboard 或 log 用）
// ─────────────────────────────────────────────
function summarize(verifiedSignals) {
  const byStrategy = {};

  for (const sig of verifiedSignals) {
    const { strategy, verification: v } = sig;
    if (!v || v.outcome === "NOT_FOUND") continue;

    if (!byStrategy[strategy]) {
      byStrategy[strategy] = {
        total: 0, wins: 0, losses: 0, timeouts: 0,
        totalR: 0, avgR: 0, winRate: 0,
      };
    }

    const s = byStrategy[strategy];
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