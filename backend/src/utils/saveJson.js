const fs = require("fs");
const path = require("path");

function saveJson(filename, data) {
  const dataDir = path.join(__dirname, "../../../data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const filePath = path.join(dataDir, filename);

  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  console.log(`Saved data to ${filePath}`);
}

module.exports = {
  saveJson,
};