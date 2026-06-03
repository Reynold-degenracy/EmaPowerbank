import type { AvailableModel } from "../types";

export function isEmbeddingModelId(modelId = "") {
  return /embedding/i.test(modelId);
}

export function preferredTestModel(models: AvailableModel[] = []) {
  const modelIds = models.map((item) => item.modelId).filter(Boolean);
  return modelIds.includes("gemini-3.5-flash") ? "gemini-3.5-flash" : modelIds[0] || "gemini-3.5-flash";
}

export function testPathForModel(modelId: string) {
  const action = isEmbeddingModelId(modelId) ? "batchEmbedContents" : "generateContent";
  return `/api/v1beta/models/${encodeURIComponent(modelId)}:${action}`;
}

export function defaultTestBodyForModel(modelId: string) {
  if (isEmbeddingModelId(modelId)) {
    return {
      requests: [
        {
          model: modelId,
          content: {
            role: "user",
            parts: [{ text: "Who are you?" }],
          },
        },
      ],
    };
  }

  return {
    contents: [
      {
        role: "user",
        parts: [{ text: "Who are you?" }],
      },
    ],
  };
}
