const fs   = require("fs");
const path = require("path");

/**
 * 儲存 JSON 到 data/ 目錄
 * @param {string} filename - 例如 "btc_1h.json"
 * @param {any}    data
 */
function saveJson(filename, data) {
  const dataDir  = path.join(__dirname, "../../../data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const filePath = path.join(dataDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`[saveJson] Saved → ${filePath}`);
}

module.exports = { saveJson };