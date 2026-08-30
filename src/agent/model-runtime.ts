import { createModels, type Model, type Models } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { AppConfig } from "../config/index.js";

export interface ConfiguredModelRuntime {
  models: Models;
  model: Model<string>;
  apiKey: string;
}

export function createConfiguredModelRuntime(config: AppConfig["model"]): ConfiguredModelRuntime {
  if (!config.enabled || !config.provider || !config.modelId || !config.apiKey) {
    throw new Error("Model runtime is not fully configured");
  }
  const models = createModels();
  models.setProvider(config.provider === "openai" ? openaiProvider() : anthropicProvider());
  const model = models.getModel(config.provider, config.modelId);
  if (!model) throw new Error(`Configured model is not present in the ${config.provider} catalog`);
  return { models, model, apiKey: config.apiKey } as ConfiguredModelRuntime;
}
