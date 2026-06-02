const http = require("http");
const fs = require("fs");
const path = require("path");
const { summarize } = require("../services/verifyService");
const { DEFAULT_SYMBOLS, dataFilename, legacyDataFilename, normalizeSymbol } = require("../utils/symbols");

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, "../../../data");
const PUBLIC_DIR = path.join(__dirname, "../../public");

function readJson(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readSymbolJson(symbol, suffix) {
  return readJson(dataFilename(symbol, suffix)) || readJson(legacyDataFilename(symbol, suffix));
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const routes = {
  "/api/symbols": () => DEFAULT_SYMBOLS.map((symbol) => ({
    symbol,
    hasKlines: Boolean(readSymbolJson(symbol, "1h")),
    hasVerified: Boolean(readSymbolJson(symbol, "1h_verified")),
  })),
  "/api/signals": ({ symbol }) => readSymbolJson(symbol, "1h_verified"),
  "/api/klines": ({ symbol }) => {
    const klines = readSymbolJson(symbol, "1h");
    if (!klines) {
      return null;
    }
    return klines.filter((k) => k.indicators?.ema200 !== null);
  },
  "/api/summary": ({ symbol }) => {
    const verified = readSymbolJson(symbol, "1h_verified");
    return verified ? summarize(verified) : null;
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const url = parsedUrl.pathname;
  const symbol = normalizeSymbol(parsedUrl.searchParams.get("symbol") || "BTCUSDT");

  if (routes[url]) {
    const data = routes[url]({ symbol });
    if (!data) {
      sendJson(res, 404, {
        error: `Required data file is missing for ${symbol}. Run fetchBTC.js and runVerification.js first.`,
      });
      return;
    }

    sendJson(res, 200, data);
    return;
  }

  const filePath = path.join(PUBLIC_DIR, url === "/" ? "index.html" : url);
  const ext = path.extname(filePath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain; charset=utf-8" });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`Chronos dashboard server listening on http://localhost:${PORT}`);
});
