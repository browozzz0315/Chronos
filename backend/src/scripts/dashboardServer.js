/**
 * dashboardServer.js
 * MVP Dashboard 伺服器
 * 執行：node src/scripts/dashboardServer.js
 * 開啟：http://localhost:3001
 *
 * 提供兩個 API：
 *   GET /api/signals   - 回傳 btc_1h_verified.json（驗證後的訊號）
 *   GET /api/klines    - 回傳 btc_1h.json（K 線 + 指標）
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT     = 3001;
const DATA_DIR = path.join(__dirname, "../../../data");
const PUB_DIR  = path.join(__dirname, "../../public");

// ── 讀 JSON 檔 ──
function readJson(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ── 簡易 Router ──
const routes = {
  "/api/signals": () => readJson("btc_1h_verified.json"),
  "/api/klines":  () => {
    const klines = readJson("btc_1h.json");
    if (!klines) return null;
    // 只回傳有 EMA200 的部分，減少傳輸量
    return klines.filter(k => k.indicators?.ema200 !== null);
  },
  "/api/summary": () => {
    const verified = readJson("btc_1h_verified.json");
    if (!verified) return null;
    const byStrat = {};
    for (const sig of verified) {
      const { strategy, verification: v } = sig;
      if (!v || v.outcome === "NOT_FOUND") continue;
      if (!byStrat[strategy]) byStrat[strategy] = { total:0, wins:0, losses:0, totalR:0 };
      const s = byStrat[strategy];
      s.total++;
      s.totalR += v.rMultiple;
      if (v.outcome.startsWith("WIN")) s.wins++;
      else if (v.outcome === "LOSS")   s.losses++;
    }
    for (const s of Object.values(byStrat)) {
      s.winRate = s.total ? +((s.wins/s.total)*100).toFixed(1) : 0;
      s.avgR    = s.total ? +(s.totalR/s.total).toFixed(3) : 0;
    }
    return byStrat;
  },
};

// ── 靜態檔案 MIME ──
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
};

const server = http.createServer((req, res) => {
  // CORS（方便本地開發）
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = req.url.split("?")[0];

  // API routes
  if (routes[url]) {
    const data = routes[url]();
    if (!data) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "資料不存在，請先執行 fetchBTC.js 和 runVerification.js" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  // 靜態檔案
  const filePath = path.join(PUB_DIR, url === "/" ? "index.html" : url);
  const ext      = path.extname(filePath);

  if (fs.existsSync(filePath)) {
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   Chronos Dashboard 已啟動               ║`);
  console.log(`║   http://localhost:${PORT}                  ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`\n  API endpoints:`);
  console.log(`    GET /api/signals   → 訊號驗證結果`);
  console.log(`    GET /api/klines    → K線 + 指標`);
  console.log(`    GET /api/summary   → 策略績效統計`);
  console.log(`\n  按 Ctrl+C 停止\n`);
});