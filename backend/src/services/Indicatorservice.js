/**
 * indicatorService.js
 * 技術指標計算模組
 * 純手寫實作（無外部依賴），方便理解邏輯
 *
 * 輸出格式：所有指標都與 K 線對齊，前幾根不夠計算的補 null
 */

// ─────────────────────────────────────────────
// EMA（指數移動平均）
// k = 2 / (period + 1)，Wilder 版本用 1/period
// ─────────────────────────────────────────────
function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  const result = new Array(closes.length).fill(null);

  // 第一個有效值用 SMA 初始化
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;

  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }

  return result;
}

// ─────────────────────────────────────────────
// RSI（相對強弱指標），預設 14 期
// ─────────────────────────────────────────────
function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  // 初始化：計算前 period 根的平均漲跌
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0);

  // Wilder 平滑
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    result[i] = avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + rs)).toFixed(2));
  }

  return result;
}

// ─────────────────────────────────────────────
// MACD（移動平均收斂發散指標）
// 預設：快線 12，慢線 26，信號線 9
// ─────────────────────────────────────────────
function calcMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const emaFast   = calcEMA(closes, fastPeriod);
  const emaSlow   = calcEMA(closes, slowPeriod);
  const macdLine  = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null
      ? parseFloat((emaFast[i] - emaSlow[i]).toFixed(4))
      : null
  );

  // Signal line = EMA9 of MACD line（只對有值的部分計算）
  const macdValues  = macdLine.filter((v) => v !== null);
  const signalRaw   = calcEMA(macdValues, signalPeriod);

  // 對齊回完整長度
  const offset      = macdLine.length - macdValues.length;
  const signalLine  = new Array(macdLine.length).fill(null);
  for (let i = 0; i < signalRaw.length; i++) {
    signalLine[i + offset] = signalRaw[i] !== null
      ? parseFloat(signalRaw[i].toFixed(4))
      : null;
  }

  const histogram = macdLine.map((v, i) =>
    v !== null && signalLine[i] !== null
      ? parseFloat((v - signalLine[i]).toFixed(4))
      : null
  );

  return { macdLine, signalLine, histogram };
}

// ─────────────────────────────────────────────
// ATR（真實波動幅度均值）
// 用於衡量波動率，也是 ADX 的基礎
// ─────────────────────────────────────────────
function calcATR(highs, lows, closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  const trueRanges = [null]; // index 0 沒有前一根
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  // 第一個 ATR 用 SMA 初始化
  let atr = trueRanges.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  result[period] = parseFloat(atr.toFixed(4));

  for (let i = period + 1; i < closes.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result[i] = parseFloat(atr.toFixed(4));
  }

  return result;
}

// ─────────────────────────────────────────────
// ADX（平均方向指數）
// ADX > 25 → 趨勢盤；ADX < 20 → 震盪盤
// +DI > -DI → 多頭趨勢；-DI > +DI → 空頭趨勢
// ─────────────────────────────────────────────
function calcADX(highs, lows, closes, period = 14) {
  const len    = closes.length;
  const plusDI  = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  const adx     = new Array(len).fill(null);

  if (len < period * 2) return { adx, plusDI, minusDI };

  const trArr = [], plusDMArr = [], minusDMArr = [];

  for (let i = 1; i < len; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    const upMove   = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    const plusDM  = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

    trArr.push(tr);
    plusDMArr.push(plusDM);
    minusDMArr.push(minusDM);
  }

  // Wilder 平滑（初始值用 sum）
  let smoothTR      = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus    = plusDMArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus   = minusDMArr.slice(0, period).reduce((a, b) => a + b, 0);

  const getPlusDI  = () => smoothTR === 0 ? 0 : (smoothPlus  / smoothTR) * 100;
  const getMinusDI = () => smoothTR === 0 ? 0 : (smoothMinus / smoothTR) * 100;

  plusDI[period]  = parseFloat(getPlusDI().toFixed(2));
  minusDI[period] = parseFloat(getMinusDI().toFixed(2));

  let dxSum = 0;
  const dxArr = [];

  for (let i = period; i < trArr.length; i++) {
    // Wilder 更新
    smoothTR    = smoothTR    - smoothTR    / period + trArr[i];
    smoothPlus  = smoothPlus  - smoothPlus  / period + plusDMArr[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDMArr[i];

    const pdi = getPlusDI();
    const mdi = getMinusDI();
    const sum = pdi + mdi;
    const dx  = sum === 0 ? 0 : Math.abs(pdi - mdi) / sum * 100;

    plusDI[i + 1]  = parseFloat(pdi.toFixed(2));
    minusDI[i + 1] = parseFloat(mdi.toFixed(2));
    dxArr.push(dx);

    if (dxArr.length >= period) {
      if (dxArr.length === period) {
        // ADX 初始值 = DX 的 SMA
        const adxVal = dxArr.reduce((a, b) => a + b, 0) / period;
        adx[i + 1]   = parseFloat(adxVal.toFixed(2));
        dxSum        = adxVal;
      } else {
        dxSum      = (dxSum * (period - 1) + dx) / period;
        adx[i + 1] = parseFloat(dxSum.toFixed(2));
      }
    }
  }

  return { adx, plusDI, minusDI };
}

// ─────────────────────────────────────────────
// Bollinger Bands（布林通道）
// ─────────────────────────────────────────────
function calcBollingerBands(closes, period = 20, stdDevMult = 2) {
  const upper  = new Array(closes.length).fill(null);
  const middle = new Array(closes.length).fill(null);
  const lower  = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const avg   = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period);

    middle[i] = parseFloat(avg.toFixed(4));
    upper[i]  = parseFloat((avg + stdDevMult * std).toFixed(4));
    lower[i]  = parseFloat((avg - stdDevMult * std).toFixed(4));
  }

  return { upper, middle, lower };
}

// ─────────────────────────────────────────────
// 市場狀態分類（Market Regime）
// 這層非常重要：同一個 RSI 訊號在趨勢盤和震盪盤勝率差距 > 30%
// ─────────────────────────────────────────────
function classifyMarketState(adxValue, plusDI, minusDI, atrPercent) {
  if (adxValue === null) return "UNKNOWN";

  let trend = "RANGING"; // 震盪
  if (adxValue >= 25) {
    trend = plusDI >= minusDI ? "UPTREND" : "DOWNTREND";
  } else if (adxValue >= 20) {
    trend = "WEAK_TREND";
  }

  let volatility = "NORMAL";
  if (atrPercent < 1.5) volatility = "LOW_VOL";
  else if (atrPercent > 4.0) volatility = "HIGH_VOL";

  return `${trend}_${volatility}`;
}

// ─────────────────────────────────────────────
// 主入口：一次計算所有指標
// 輸入：K 線陣列（已解析為 Float 的版本）
// 輸出：每根 K 線附加所有指標值
// ─────────────────────────────────────────────
function calcAllIndicators(klines) {
  const closes = klines.map((k) => k.close);
  const highs  = klines.map((k) => k.high);
  const lows   = klines.map((k) => k.low);

  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const rsi14  = calcRSI(closes, 14);
  const macd   = calcMACD(closes);
  const atr14  = calcATR(highs, lows, closes, 14);
  const adxData = calcADX(highs, lows, closes, 14);
  const bb     = calcBollingerBands(closes, 20);

  return klines.map((k, i) => {
    const currentAtr     = atr14[i];
    const atrPercent     = currentAtr ? (currentAtr / k.close) * 100 : null;
    const marketState    = classifyMarketState(
      adxData.adx[i],
      adxData.plusDI[i],
      adxData.minusDI[i],
      atrPercent
    );

    return {
      ...k,
      indicators: {
        ema20:       ema20[i]  ? parseFloat(ema20[i].toFixed(2))  : null,
        ema50:       ema50[i]  ? parseFloat(ema50[i].toFixed(2))  : null,
        ema200:      ema200[i] ? parseFloat(ema200[i].toFixed(2)) : null,
        rsi14:       rsi14[i],
        macd:        macd.macdLine[i],
        macdSignal:  macd.signalLine[i],
        macdHist:    macd.histogram[i],
        atr14:       currentAtr,
        atrPercent:  atrPercent ? parseFloat(atrPercent.toFixed(3)) : null,
        adx:         adxData.adx[i],
        plusDI:      adxData.plusDI[i],
        minusDI:     adxData.minusDI[i],
        bbUpper:     bb.upper[i],
        bbMiddle:    bb.middle[i],
        bbLower:     bb.lower[i],
        marketState,
      },
    };
  });
}

module.exports = {
  calcEMA,
  calcRSI,
  calcMACD,
  calcATR,
  calcADX,
  calcBollingerBands,
  calcAllIndicators,
  classifyMarketState,
};