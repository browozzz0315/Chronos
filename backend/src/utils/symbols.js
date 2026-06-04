const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function symbolToFilePrefix(symbol) {
  return normalizeSymbol(symbol).toLowerCase();
}

function parseSymbols(value, fallback = DEFAULT_SYMBOLS) {
  if (!value) return fallback;

  const symbols = String(value)
    .split(",")
    .map(normalizeSymbol)
    .filter(Boolean);

  return symbols.length ? symbols : fallback;
}

function dataFilename(symbol, suffix) {
  return `${symbolToFilePrefix(symbol)}_${suffix}.json`;
}

function legacyDataFilename(symbol, suffix) {
  const normalized = normalizeSymbol(symbol);
  if (normalized === "BTCUSDT") {
    return `btc_${suffix}.json`;
  }
  return dataFilename(normalized, suffix);
}

module.exports = {
  DEFAULT_SYMBOLS,
  normalizeSymbol,
  symbolToFilePrefix,
  parseSymbols,
  dataFilename,
  legacyDataFilename,
};
