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
    defaultModel: "openai/gpt-oss-20b",
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
  return JSON.stringify(value ?? {}, null, 2);
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

function createDailyReportMessages({ symbol, asOf, summary, recentSignals }) {
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
        `recentSignals: ${toCompactJson(recentSignals)}`,
    },
  ];
}

async function createChatCompletion(messages, options = {}) {
  const config = getProviderConfig(options.provider);
  if (!config) {
    return null;
  }

  const response = await axios.post(
    `${config.baseUrl}/chat/completions`,
    {
      model: config.model,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 300,
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: options.timeoutMs ?? 30000,
    }
  );

  const text = response?.data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`LLM response was empty (${config.provider})`);
  }

  return {
    provider: config.provider,
    model: config.model,
    text,
  };
}

async function generateSignalExplanation(signal, options = {}) {
  const result = await createChatCompletion(
    createSignalExplanationMessages(signal),
    {
      provider: options.provider,
      maxTokens: 260,
      temperature: 0.2,
      timeoutMs: options.timeoutMs,
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

  let generated = 0;
  let skipped = 0;
  const enriched = [];

  for (const signal of signals) {
    if (signal.llm?.explanation) {
      skipped += 1;
      enriched.push(signal);
      continue;
    }

    try {
      const llm = await generateSignalExplanation(signal, options);
      if (llm) {
        generated += 1;
        enriched.push({ ...signal, llm });
      } else {
        skipped += 1;
        enriched.push(signal);
      }
    } catch (err) {
      enriched.push({
        ...signal,
        llm: {
          provider: resolveProviderName(options.provider),
          generatedAt: new Date().toISOString(),
          error: err.message,
        },
      });
    }
  }

  return {
    signals: enriched,
    generated,
    skipped,
    provider: getProviderConfig(options.provider)?.provider || null,
  };
}

async function generateDailyReport(payload, options = {}) {
  const result = await createChatCompletion(
    createDailyReportMessages(payload),
    {
      provider: options.provider,
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: options.timeoutMs,
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
