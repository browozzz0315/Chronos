/**
 * runVerification.js
 * 對所有訊號執行延遲驗證並輸出結果
 * 執行：node src/scripts/runVerification.js
 */

const fs   = require("fs");
const path = require("path");
const { generateSignals }      = require("../services/signalService");
const { verifyAll, summarize } = require("../services/verifyService");

function loadData(filename) {
  const p = path.join(__dirname, "../../../data", filename);
  if (!fs.existsSync(p)) throw new Error(`找不到: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function saveData(filename, data) {
  const dir = path.join(__dirname, "../../../data");
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), "utf-8");
}

function formatTime(ms) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function outcomeEmoji(outcome) {
  if (!outcome) return "⏳";
  if (outcome.startsWith("WIN"))          return "✅";
  if (outcome === "LOSS")                 return "❌";
  if (outcome === "TIMEOUT_PROFIT")       return "🟡";
  if (outcome === "TIMEOUT_LOSS")         return "🔴";
  return "⚪";
}

function printDivider(title = "") {
  const line = "─".repeat(62);
  console.log(title ? `\n${line}\n  ${title}\n${line}` : line);
}

async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║          Chronos 延遲驗證系統 Step 9               ║");
  console.log("╚════════════════════════════════════════════════════╝");

  // 1. 載入資料
  const klines  = loadData("btc_1h.json");
  console.log(`\n  載入 K 線: ${klines.length} 根`);
  console.log(`  時間範圍: ${formatTime(klines[0].openTime)} → ${formatTime(klines[klines.length-1].openTime)}`);

  // 2. 產生訊號
  const signals = generateSignals(klines);
  console.log(`  訊號總數: ${signals.length} 個\n`);

  // 3. 驗證（最多追蹤 24 根）
  const verified = verifyAll(signals, klines, 24);

  // 4. 印出每筆訊號詳情
  printDivider("各訊號驗證結果");
  for (const sig of verified) {
    const v = sig.verification;
    const emoji = outcomeEmoji(v?.outcome);

    console.log(`\n  ${emoji} [${sig.strategy}] ${sig.direction}`);
    console.log(`     進場時間 : ${formatTime(sig.openTime)}`);
    console.log(`     進場價   : ${sig.entryPrice}`);

    if (v.outcome === "NOT_FOUND") {
      console.log(`     ⚠️  找不到對應 K 線，跳過`);
      continue;
    }

    console.log(`     止盈止損 : SL ${v.levels.sl}  |  TP1 ${v.levels.tp1}  |  TP2 ${v.levels.tp2}  |  TP3 ${v.levels.tp3}`);
    console.log(`     ATR距離  : ±${v.levels.slDist} (${(v.levels.slDist / sig.entryPrice * 100).toFixed(2)}%)`);
    console.log(`     出場原因 : ${v.exitReason}（第 ${v.exitBar ?? "-"} 根後）`);
    console.log(`     出場價   : ${v.exitPrice}`);
    console.log(`     結果     : ${v.outcome}  R=${v.rMultiple > 0 ? "+" : ""}${v.rMultiple}  PnL=${v.pnlPct > 0 ? "+" : ""}${v.pnlPct}%`);
    console.log(`     MFE/MAE  : 最大浮盈 ${v.mfe}  /  最大回撤 ${v.mae}`);

    // 訊號觸發當時的市場狀態
    const entryK = klines.find(k => k.openTime === sig.openTime);
    if (entryK?.indicators?.marketState) {
      console.log(`     市場狀態 : ${entryK.indicators.marketState}`);
    }
  }

  // 5. 統計摘要
  printDivider("策略績效統計");
  const summary = summarize(verified);

  if (Object.keys(summary).length === 0) {
    console.log("  （尚無可統計的訊號）");
  } else {
    console.log(`\n  ${"策略".padEnd(22)} ${"總數".padEnd(6)} ${"勝".padEnd(5)} ${"敗".padEnd(5)} ${"勝率".padEnd(8)} ${"平均R"}`);
    console.log("  " + "─".repeat(56));
    for (const [name, s] of Object.entries(summary)) {
      const bar  = "█".repeat(Math.round(s.winRate / 10));
      const note = s.total < 5 ? " ⚠️ 樣本過少" : "";
      console.log(
        `  ${name.padEnd(22)} ${String(s.total).padEnd(6)} ${String(s.wins).padEnd(5)} ${String(s.losses).padEnd(5)} ${(s.winRate + "%").padEnd(8)} ${s.avgR > 0 ? "+" : ""}${s.avgR}${note}`
      );
    }
  }

  // 6. 儲存結果
  saveData("btc_1h_verified.json", verified);
  console.log("\n  💾 儲存 → data/btc_1h_verified.json");

  // 7. 重點提醒
  printDivider("注意事項");
  const pendingCount = verified.filter(s => s.verification?.exitReason === "TIMEOUT").length;
  const latest = verified[verified.length - 1];
  const latestIsRecent = Date.now() - latest?.openTime < 24 * 60 * 60 * 1000;

  if (latestIsRecent) {
    console.log(`  ⏳ 最新訊號距今不到 24 小時，驗證結果可能是 TIMEOUT（尚未出場）`);
    console.log(`     需要更多 K 線資料才能確認最終結果`);
  }
  if (pendingCount > 0) {
    console.log(`  ⚠️  共 ${pendingCount} 筆訊號以 TIMEOUT 結案（24根內未碰 SL 或 TP3）`);
    console.log(`     這些訊號的出場價是第 24 根的收盤價，非實際平倉價`);
  }
  console.log(`\n  📊 樣本數 ${signals.length} 筆，統計意義有限，需累積 50+ 筆才可信`);
}

main().catch(err => {
  console.error("❌", err.message);
  process.exit(1);
});