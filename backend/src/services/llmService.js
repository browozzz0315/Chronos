const axios = require("axios");

const PROVIDER_CONFIG = {
  openai: {
    envKey: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5-mini",
  },
  groq: {
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
};

function resolveProviderName(preferredProvider = process.env.CHRONOS_LLM_PROVIDER || "auto") {
  const requested = String(preferredProvider || "auto").trim().toLowerCase();

  if (requested !== "auto") {
    return PROVIDER_CONFIG[requested] ? requested : null;
  }

  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GROQ_API_KEY) return "groq";
  return null;
}

function getProviderConfig(preferredProvider) {
  const provider = resolveProviderName(preferredProvider);
  if (!provider) {
    return null;
  }

  const base = PROVIDER_CONFIG[provider];
  const apiKey = process.env[base.envKey];
  if (!apiKey) {
    return null;
  }

  const model =
    process.env.CHRONOS_LLM_MODEL ||
    process.env[provider === "openai" ? "OPENAI_MODEL" : "GROQ_MODEL"] ||
    base.defaultModel;

  return {
    provider,
    apiKey,
    baseUrl: base.baseUrl,
    model,
  };
}

function isLlmEnabled(preferredProvider) {
  return Boolean(getProviderConfig(preferredProvider));
}

function toCompactJson(value) {
  return JSON.stringify(value ?? {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function resolveExplainOptions(options = {}) {
  return {
    provider: options.provider,
    mode: String(
      options.explainMode ||
      process.env.CHRONOS_LLM_EXPLAIN_SIGNALS ||
      "trade"
    ).toLowerCase(),
    maxPerRun: options.maxPerRun ?? envNumber("CHRONOS_LLM_MAX_EXPLANATIONS_PER_RUN", 3),
    skipPending: options.skipPending ?? envFlag("CHRONOS_LLM_SKIP_PENDING", true),
    delayMs: options.delayMs ?? envNumber("CHRONOS_LLM_DELAY_MS", 1200),
    retry429DelayMs: options.retry429DelayMs ?? envNumber("CHRONOS_LLM_RETRY_429_DELAY_MS", 5000),
  };
}

function isPendingSignal(signal) {
  return Boolean(signal.verification?.outcome?.startsWith("PENDING"));
}

function shouldExplainSignal(signal, options) {
  if (!signal || signal.llm?.explanation) return false;
  if (options.mode === "none" || options.maxPerRun <= 0) return false;
  if (options.skipPending && isPendingSignal(signal)) return false;
  if (options.mode === "all") return true;
  if (options.mode === "observation") return signal.signalType === "OBSERVATION";
  return signal.signalType !== "OBSERVATION";
}

function selectSignalsForExplanation(signals, options) {
  return [...signals]
    .filter((signal) => shouldExplainSignal(signal, options))
    .sort((a, b) => {
      const aTrade = a.signalType === "OBSERVATION" ? 0 : 1;
      const bTrade = b.signalType === "OBSERVATION" ? 0 : 1;
      if (aTrade !== bTrade) return bTrade - aTrade;

      const aComplete = a.verification?.isComplete ? 1 : 0;
      const bComplete = b.verification?.isComplete ? 1 : 0;
      if (aComplete !== bComplete) return bComplete - aComplete;

      return b.openTime - a.openTime;
    })
    .slice(0, options.maxPerRun);
}

function isRateLimitError(err) {
  return err?.response?.status === 429;
}

function buildChatRequest(config, messages, options = {}) {
  const request = {
    model: config.model,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 300,
    messages,
  };

  // Groq GPT-OSS models are reasoning models. Keep reasoning cheap so the
  // response budget is spent on visible content rather than hidden reasoning.
  if (config.provider === "groq" && config.model.startsWith("openai/gpt-oss")) {
    request.reasoning_effort = options.reasoningEffort || "low";
  }

  return request;
}

function extractResponseText(response) {
  const choice = response?.data?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("")
      .trim();
  }

  return "";
}

function createSignalExplanationMessages(signal) {
  const verification = signal.verification || {};
  const quality = signal.quality || {};
  const snapshot = signal.snapshot || {};

  return [
    {
      role: "system",
      content:
        "你是 Chronos 的交易訊號分析助手。請使用繁體中文，根據提供的規則型訊號資料，" +
        "輸出精簡、可讀、保守的解釋。不要保證未來結果，不要捏造資料，不要提供投資建議。",
    },
    {
      role: "user",
      content:
        "請用 3 到 5 句繁體中文，解釋這筆訊號為什麼被觸發，以及驗證結果代表什麼。\n" +
        "格式要求：純文字，不要 markdown，不要條列編號。\n\n" +
        `symbol: ${signal.symbol}\n` +
        `strategy: ${signal.strategy}\n` +
        `direction: ${signal.direction}\n` +
        `openTime: ${new Date(signal.openTime).toISOString()}\n` +
        `entryPrice: ${signal.entryPrice}\n` +
        `conditions: ${toCompactJson(signal.conditions)}\n` +
        `snapshot: ${toCompactJson({
          close: snapshot.close,
          rsi14: snapshot.rsi14,
          macdHist: snapshot.macdHist,
          adx14: snapshot.adx14,
          atr14: snapshot.atr14,
          ema20: snapshot.ema20,
          ema50: snapshot.ema50,
          ema200: snapshot.ema200,
          volume: snapshot.volume,
          volumeSma20: snapshot.volumeSma20,
          marketState: snapshot.marketState,
        })}\n` +
        `quality: ${toCompactJson(quality)}\n` +
        `verification: ${toCompactJson({
          outcome: verification.outcome,
          exitReason: verification.exitReason,
          exitBar: verification.exitBar,
          rMultiple: verification.rMultiple,
          pnlPct: verification.pnlPct,
          tp1Hit: verification.tp1Hit,
          tp2Hit: verification.tp2Hit,
          tp3Hit: verification.tp3Hit,
          slHit: verification.slHit,
          mfe: verification.mfe,
          mae: verification.mae,
        })}`,
    },
  ];
}

function createDailyReportMessages({
  symbol,
  asOf,
  summary,
  recentSignals,
  representativeSignals,
  observationAnalysis,
}) {
  return [
    {
      role: "system",
      content:
        "你是 Chronos 的策略報告助手。請使用繁體中文輸出一份簡短、務實、適合開發者快速閱讀的報告。" +
        "聚焦在策略結果、樣本限制、下一步觀察重點。不要提供投資建議。",
    },
    {
      role: "user",
      content:
        "請根據以下資料產生 4 到 8 句的每日報告，格式為純文字。\n\n" +
        `symbol: ${symbol}\n` +
        `asOf: ${asOf}\n` +
        `summary: ${toCompactJson(summary)}\n` +
        `recentSignals: ${toCompactJson(recentSignals)}\n` +
        `representativeSignals: ${toCompactJson(representativeSignals || [])}\n` +
        `observationAnalysis: ${toCompactJson(observationAnalysis || {})}`,
    },
  ];
}

function createSignalExplanationMessagesSafe(signal) {
  const verification = signal.verification || {};
  const quality = signal.quality || {};
  const snapshot = signal.snapshot || {};

  return [
    {
      role: "system",
      content:
        "你是 Chronos 的交易訊號分析助手。請使用繁體中文，根據提供的規則型訊號資料，" +
        "輸出精簡、可讀、保守的解釋。不要保證未來結果，不要捏造資料，不要提供投資建議。",
    },
    {
      role: "user",
      content:
        "請用 3 到 5 句繁體中文，解釋這筆訊號為什麼被觸發，以及驗證結果代表什麼。\n" +
        "格式要求：純文字，不要 markdown，不要條列編號。\n\n" +
        `symbol: ${signal.symbol}\n` +
        `signalType: ${signal.signalType}\n` +
        `strategy: ${signal.strategy}\n` +
        `direction: ${signal.direction}\n` +
        `openTime: ${new Date(signal.openTime).toISOString()}\n` +
        `entryPrice: ${signal.entryPrice}\n` +
        `conditions: ${toCompactJson(signal.conditions)}\n` +
        `snapshot: ${toCompactJson({
          close: snapshot.close,
          rsi14: snapshot.rsi14,
          macdHist: snapshot.macdHist,
          adx: snapshot.adx,
          atr14: snapshot.atr14,
          ema20: snapshot.ema20,
          ema50: snapshot.ema50,
          ema200: snapshot.ema200,
          marketState: snapshot.marketState,
          observationScore: snapshot.observationScore,
        })}\n` +
        `quality: ${toCompactJson(quality)}\n` +
        `verification: ${toCompactJson({
          outcome: verification.outcome,
          exitReason: verification.exitReason,
          checkedBars: verification.checkedBars,
          isComplete: verification.isComplete,
          rMultiple: verification.rMultiple,
          pnlPct: verification.pnlPct,
          mfe: verification.mfe,
          mae: verification.mae,
        })}`,
    },
  ];
}

function createDailyReportMessagesSafe({
  symbol,
  asOf,
  summary,
  recentSignals,
  representativeSignals,
  observationAnalysis,
}) {
  return [
    {
      role: "system",
      content:
        "你是 Chronos 的策略報告助手。請使用繁體中文輸出一份簡短、務實、適合開發者快速閱讀的報告。" +
        "請同時分析正式策略訊號與 OBS 觀察型訊號。OBS 是批次統計樣本，不是逐筆交易建議。" +
        "聚焦策略結果、樣本限制、市場狀態差異、下一步觀察重點。不要提供投資建議。",
    },
    {
      role: "user",
      content:
        "請根據以下資料產生 5 到 9 句的每日報告，格式為純文字。請使用 summary 與 observationAnalysis 判斷整體表現，" +
        "使用 representativeSignals 補充具代表性的案例，不要逐筆列舉所有訊號。\n\n" +
        `symbol: ${symbol}\n` +
        `asOf: ${asOf}\n` +
        `summary: ${toCompactJson(summary)}\n` +
        `observationAnalysis: ${toCompactJson(observationAnalysis || {})}\n` +
        `recentSignals: ${toCompactJson(recentSignals || [])}\n` +
        `representativeSignals: ${toCompactJson(representativeSignals || [])}`,
    },
  ];
}

async function createChatCompletion(messages, options = {}) {
  const config = getProviderConfig(options.provider);
  if (!config) {
    return null;
  }

  let response;
  try {
    response = await axios.post(
      `${config.baseUrl}/chat/completions`,
      buildChatRequest(config, messages, options),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: options.timeoutMs ?? 30000,
      }
    );
  } catch (err) {
    if (!isRateLimitError(err) || options.retryOn429 === false) {
      throw err;
    }

    const retryAfter = Number(err.response?.headers?.["retry-after"]);
    const retryDelayMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : options.retry429DelayMs ?? 5000;

    await sleep(retryDelayMs);
    response = await axios.post(
      `${config.baseUrl}/chat/completions`,
      buildChatRequest(config, messages, options),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: options.timeoutMs ?? 30000,
      }
    );
  }

  const text = extractResponseText(response);
  if (!text) {
    const choice = response?.data?.choices?.[0];
    throw new Error(
      `LLM response was empty (${config.provider}, model=${config.model}, finish=${choice?.finish_reason || "unknown"})`
    );
  }

  return {
    provider: config.provider,
    model: config.model,
    text,
  };
}

async function generateSignalExplanation(signal, options = {}) {
  const result = await createChatCompletion(
    createSignalExplanationMessagesSafe(signal),
    {
      provider: options.provider,
      maxTokens: 260,
      temperature: 0.2,
      timeoutMs: options.timeoutMs,
      retry429DelayMs: options.retry429DelayMs,
    }
  );

  if (!result) {
    return null;
  }

  return {
    provider: result.provider,
    model: result.model,
    generatedAt: new Date().toISOString(),
    explanation: result.text,
  };
}

async function enrichSignalsWithExplanations(signals, options = {}) {
  if (!isLlmEnabled(options.provider) || !Array.isArray(signals) || !signals.length) {
    return {
      signals,
      generated: 0,
      skipped: Array.isArray(signals) ? signals.length : 0,
      provider: getProviderConfig(options.provider)?.provider || null,
    };
  }

  const explainOptions = resolveExplainOptions(options);
  const selected = selectSignalsForExplanation(signals, explainOptions);
  const selectedIds = new Set(selected.map((signal) => signal.id));
  let generated = 0;
  let skipped = 0;
  let rateLimited = false;
  const enriched = [];

  for (const signal of signals) {
    if (signal.llm?.explanation) {
      skipped += 1;
      enriched.push(signal);
      continue;
    }

    if (!selectedIds.has(signal.id) || rateLimited) {
      skipped += 1;
      enriched.push(signal);
      continue;
    }

    try {
      const llm = await generateSignalExplanation(signal, explainOptions);
      if (llm) {
        generated += 1;
        enriched.push({ ...signal, llm });
      } else {
        skipped += 1;
        enriched.push(signal);
      }
    } catch (err) {
      if (isRateLimitError(err)) {
        rateLimited = true;
      }

      enriched.push({
        ...signal,
        llm: {
          provider: resolveProviderName(options.provider),
          generatedAt: new Date().toISOString(),
          error: err.message,
        },
      });
    }

    if (explainOptions.delayMs > 0) {
      await sleep(explainOptions.delayMs);
    }
  }

  return {
    signals: enriched,
    generated,
    skipped,
    rateLimited,
    selected: selected.length,
    provider: getProviderConfig(options.provider)?.provider || null,
  };
}

async function generateDailyReport(payload, options = {}) {
  const result = await createChatCompletion(
    createDailyReportMessagesSafe(payload),
    {
      provider: options.provider,
      maxTokens: options.maxTokens ?? envNumber("CHRONOS_REPORT_MAX_TOKENS", 900),
      temperature: 0.2,
      timeoutMs: options.timeoutMs,
      retry429DelayMs: options.retry429DelayMs,
    }
  );

  if (!result) {
    return null;
  }

  return {
    provider: result.provider,
    model: result.model,
    generatedAt: new Date().toISOString(),
    report: result.text,
  };
}

module.exports = {
  isLlmEnabled,
  getProviderConfig,
  generateSignalExplanation,
  enrichSignalsWithExplanations,
  generateDailyReport,
};
