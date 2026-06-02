const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Persist JSON into the shared data directory.
 * Uses a temp file + rename and retries transient Windows file-lock errors.
 */
async function saveJson(filename, data, options = {}) {
  const dataDir = path.join(__dirname, "../../../data");
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 150;

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const filePath = path.join(dataDir, filename);
  const tempPath = `${filePath}.tmp`;
  const payload = JSON.stringify(data, null, 2);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fs.writeFileSync(tempPath, payload, "utf-8");
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(tempPath, filePath);
        fs.unlinkSync(tempPath);
      } else {
        fs.renameSync(tempPath, filePath);
      }
      console.log(`[saveJson] Saved -> ${filePath}`);
      return;
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

      const retryable = err && (err.code === "EPERM" || err.code === "EBUSY");
      if (!retryable || attempt === retries) {
        throw err;
      }

      await sleep(delayMs * (attempt + 1));
    }
  }
}

module.exports = { saveJson };
