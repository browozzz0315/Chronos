/**
 * signalService.js
 * 規則型訊號產生器（Step 8）
 *
 * 設計原則：
 * - 每個策略都是獨立函式，方便日後個別驗證勝率
 * - 每個訊號記錄「觸發條件快照」，延遲驗證時才知道當時為什麼進場
 * - EMA200 若為 null（資料不足）會自動 skip，不產生假訊號
 */

// ─────────────────────────────────────────────────────
// 輔助：計算最近 N 根的平均成交量
// ─────────────────────────────────────────────────────
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
// 適合：趨勢盤做順勢回踩
// ─────────────────────────────────────────────────────
function strategyTrendLong(kline, index, allKlines) {
  const { close } = kline;
  const { ema20, ema50, ema200, rsi14, macdHist, adx } = kline.indicators;

  // EMA200 null 代表資料不足，直接跳過
  if (!ema20 || !ema50 || !ema200 || rsi14 === null || macdHist === null) {
    return null;
  }

  const conditions = {
    ema_alignment:   ema20 > ema50 && ema50 > ema200,   // 多頭排列
    rsi_healthy:     rsi14 >= 45 && rsi14 <= 65,         // 動能健康區間
    price_above_ema: close > ema20,                      // 收盤在 EMA20 上方
    macd_positive:   macdHist > 0,                       // 動能向上
    adx_trending:    adx === null || adx >= 20,          // 有趨勢（ADX 可能 null）
  };

  const passed = Object.values(conditions).every(Boolean);
  if (!passed) return null;

  return {
    strategy:   "TREND_LONG",
    direction:  "LONG",
    conditions, // 記錄每個條件是否通過，驗證時用
    snapshot: { close, ema20, ema50, ema200, rsi14, macdHist, adx },
  };
}

// ─────────────────────────────────────────────────────
// 策略 B：超賣反彈做多
// 條件：
//   1. RSI < 30（超賣）
//   2. 當根成交量 > 20 期均量的 1.3 倍（量能放大，有人在接）
//   3. 收盤在 EMA200 上方（大趨勢仍偏多，不做逆勢反彈）
//   4. 前一根也是下跌（確認是在跌勢中超賣，非持續崩跌）
// 適合：回調過深後的短反彈
// ─────────────────────────────────────────────────────
function strategyOversoldBounce(kline, index, allKlines) {
  const { close, volume } = kline;
  const { rsi14, ema200 } = kline.indicators;

  if (rsi14 === null || !ema200 || index < 1) return null;

  const avgVol   = avgVolume(allKlines, index, 20);
  const prevKline = allKlines[index - 1];

  if (!avgVol) return null;

  const conditions = {
    rsi_oversold:      rsi14 < 30,
    volume_surge:      volume > avgVol * 1.3,          // 成交量放大
    above_ema200:      close > ema200,                 // 大趨勢偏多
    prev_was_bearish:  prevKline.close < prevKline.open, // 前一根收陰線
  };

  const passed = Object.values(conditions).every(Boolean);
  if (!passed) return null;

  return {
    strategy:  "OVERSOLD_BOUNCE",
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
// ─────────────────────────────────────────────────────
function strategyTrendShort(kline, index, allKlines) {
  const { close } = kline;
  const { ema20, ema50, ema200, rsi14, macdHist, adx } = kline.indicators;

  if (!ema20 || !ema50 || !ema200 || rsi14 === null || macdHist === null) {
    return null;
  }

  const conditions = {
    ema_alignment:    ema20 < ema50 && ema50 < ema200,  // 空頭排列
    rsi_healthy:      rsi14 >= 35 && rsi14 <= 55,        // 動能偏空區間
    price_below_ema:  close < ema20,                     // 收盤在 EMA20 下方
    macd_negative:    macdHist < 0,                      // 動能向下
    adx_trending:     adx === null || adx >= 20,
  };

  const passed = Object.values(conditions).every(Boolean);
  if (!passed) return null;

  return {
    strategy:  "TREND_SHORT",
    direction: "SHORT",
    conditions,
    snapshot: { close, ema20, ema50, ema200, rsi14, macdHist, adx },
  };
}

// ─────────────────────────────────────────────────────
// 主入口：對整批 K 線跑所有策略
// 回傳所有觸發的訊號（一根 K 線可能觸發多個策略）
// ─────────────────────────────────────────────────────
function generateSignals(klines) {
  const strategies = [
    strategyTrendLong,
    strategyOversoldBounce,
    strategyTrendShort,
  ];

  const signals = [];

  for (let i = 1; i < klines.length; i++) {
    const kline = klines[i];

    for (const strategy of strategies) {
      const result = strategy(kline, i, klines);
      if (!result) continue;

      signals.push({
        id:          `${result.strategy}_${kline.openTime}`,
        openTime:    kline.openTime,
        symbol:      "BTCUSDT",       // 之後抽成參數
        entryPrice:  kline.close,     // 用收盤價當進場價（下一根開盤更精確，Step 9 再調整）
        ...result,
        verifiedAt:  null,            // Step 9 延遲驗證後填入
        outcome:     null,            // "WIN" | "LOSS" | "PENDING"
      });
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