const fs = require("fs");
const path = require("path");
const { saveJson } = require("./saveJson");

function getDataPath(filename) {
  return path.join(__dirname, "../../../data", filename);
}

function loadHistory(filename) {
  const filePath = getDataPath(filename);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Array.isArray(data) ? data : [];
}

function indexSignalsById(signals) {
  return new Map((signals || []).map((signal) => [signal.id, signal]));
}

/**
 * Reuse persisted fields from history so repeated verification runs do not
 * erase previously generated LLM explanations or other derived metadata.
 */
function mergeSignalsWithHistory(signals, history) {
  const historyById = indexSignalsById(history);

  return (signals || []).map((signal) => {
    const previous = historyById.get(signal.id);
    if (!previous) {
      return signal;
    }

    return {
      ...signal,
      llm: signal.llm || previous.llm,
    };
  });
}

/**
 * Merge verified signals into a persistent history file.
 * - Same signal id: overwrite with newest payload
 * - New signal id: append
 * - Final output: sorted by openTime ascending
 */
async function upsertSignalHistory(filename, signals) {
  const history = loadHistory(filename);
  const merged = new Map(history.map((signal) => [signal.id, signal]));

  for (const signal of signals) {
    merged.set(signal.id, signal);
  }

  const nextHistory = [...merged.values()].sort((a, b) => {
    if (a.openTime !== b.openTime) return a.openTime - b.openTime;
    return String(a.id).localeCompare(String(b.id));
  });

  await saveJson(filename, nextHistory);

  return {
    previousCount: history.length,
    nextCount: nextHistory.length,
    inserted: Math.max(nextHistory.length - history.length, 0),
  };
}

module.exports = {
  loadHistory,
  mergeSignalsWithHistory,
  upsertSignalHistory,
};
