"use strict";

const RESPONSE_ID_PATTERN = /^resp_[A-Za-z0-9_-]+$/;
const PENDING_STATUSES = new Set(["queued", "in_progress"]);

function cleanText(value, limit = 2_000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
}

async function requestOpenAiResponse(path, {
  method = "GET",
  body = null,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const token = cleanText(apiKey, 10_000);
  if (!token) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetchImpl(`https://api.openai.com/v1/responses${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(
      cleanText(payload?.error?.message, 1_000)
      || `OpenAI Responses request failed (${response.status})`
    );
    error.code = "OPENAI_RESPONSES_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function startBackgroundResponse(body, { request = requestOpenAiResponse } = {}) {
  const response = await request("", { method: "POST", body });
  if (!RESPONSE_ID_PATTERN.test(String(response?.id || ""))) {
    const error = new Error("OpenAI did not return a valid background response id");
    error.code = "OPENAI_BACKGROUND_ID_MISSING";
    throw error;
  }
  return response;
}

async function retrieveBackgroundResponse(jobId, { request = requestOpenAiResponse } = {}) {
  if (!RESPONSE_ID_PATTERN.test(String(jobId || ""))) {
    const error = new Error("invalid OpenAI background response id");
    error.code = "OPENAI_BACKGROUND_ID_INVALID";
    throw error;
  }
  return request(`/${encodeURIComponent(jobId)}`);
}

function responseOutputText(response) {
  const direct = cleanText(response?.output_text, 1_000_000);
  if (direct) return direct;
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text") {
        const text = cleanText(content.text, 1_000_000);
        if (text) return text;
      }
    }
  }
  return "";
}

function backgroundResponseState(response) {
  const status = cleanText(response?.status, 80).toLowerCase() || "unknown";
  if (PENDING_STATUSES.has(status)) {
    return {
      pending: true,
      status,
      retryAfterMs: 2_000,
    };
  }
  if (status !== "completed") {
    const detail = cleanText(
      response?.error?.message
      || response?.incomplete_details?.reason
      || `background response ended with status ${status}`,
      1_000
    );
    const error = new Error(detail);
    error.code = "OPENAI_BACKGROUND_RESPONSE_FAILED";
    error.status = status;
    throw error;
  }
  return {
    pending: false,
    status,
    retryAfterMs: 0,
  };
}

module.exports = {
  RESPONSE_ID_PATTERN,
  requestOpenAiResponse,
  startBackgroundResponse,
  retrieveBackgroundResponse,
  responseOutputText,
  backgroundResponseState,
};
