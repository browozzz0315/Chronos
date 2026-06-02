const http = require("http");
const fs = require("fs");
const path = require("path");
const { summarize } = require("../services/verifyService");

const PORT = 3001;
const DATA_DIR = path.join(__dirname, "../../../data");
const PUBLIC_DIR = path.join(__dirname, "../../public");

function readJson(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const routes = {
  "/api/signals": () => readJson("btc_1h_verified.json"),
  "/api/klines": () => {
    const klines = readJson("btc_1h.json");
    if (!klines) {
      return null;
    }
    return klines.filter((k) => k.indicators?.ema200 !== null);
  },
  "/api/summary": () => {
    const verified = readJson("btc_1h_verified.json");
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

  const url = req.url.split("?")[0];
  if (routes[url]) {
    const data = routes[url]();
    if (!data) {
      sendJson(res, 404, {
        error: "Required data file is missing. Run fetchBTC.js and runVerification.js first.",
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
