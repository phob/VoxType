export type OpenAiErrorCategory =
  | "invalid_key"
  | "billing"
  | "rate_limit"
  | "model_access"
  | "api_shape"
  | "network"
  | "unknown";

export type OpenAiFriendlyError = {
  category: OpenAiErrorCategory;
  summary: string;
  technicalDetail: string;
};

export function classifyOpenAiError(input: {
  status?: number;
  statusText?: string;
  type?: string | null;
  code?: string | null;
  message?: string | null;
}): OpenAiFriendlyError {
  const detail = [input.status, input.statusText, input.type, input.code]
    .filter((part) => part !== undefined && part !== null && String(part).trim())
    .join(" / ");
  const haystack = `${input.status ?? ""} ${input.type ?? ""} ${input.code ?? ""} ${input.message ?? ""}`.toLowerCase();

  if (input.status === 401 || haystack.includes("invalid_api_key")) {
    return {
      category: "invalid_key",
      summary: "OpenAI rejected the API key. Check that the key is copied correctly.",
      technicalDetail: detail || "401"
    };
  }

  if (input.status === 402 || haystack.includes("billing") || haystack.includes("insufficient_quota")) {
    return {
      category: "billing",
      summary: "OpenAI billing or quota is not available for this API key.",
      technicalDetail: detail || "billing"
    };
  }

  if (input.status === 429 || haystack.includes("rate_limit")) {
    return {
      category: "rate_limit",
      summary: "OpenAI rate limits were reached. Try again later or check your usage limits.",
      technicalDetail: detail || "429"
    };
  }

  if (haystack.includes("beta_api_shape_disabled")) {
    return {
      category: "api_shape",
      summary: "OpenAI rejected the Realtime API request shape. Update VoxType or switch to a supported cloud mode.",
      technicalDetail: detail || "beta_api_shape_disabled"
    };
  }

  if (input.status === 404 || haystack.includes("model") || haystack.includes("access")) {
    return {
      category: "model_access",
      summary: "The selected OpenAI transcription model is unavailable for this API key.",
      technicalDetail: detail || "model_access"
    };
  }

  return {
    category: input.status ? "unknown" : "network",
    summary: "OpenAI transcription failed. Check the API key, billing, rate limits, and model access.",
    technicalDetail: detail || "unknown"
  };
}

export function formatOpenAiFriendlyError(error: OpenAiFriendlyError): string {
  return `${error.summary} Technical details: ${error.technicalDetail}`;
}
