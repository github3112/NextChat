import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    const discoveredModels = collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
    const endpointModelIds = new Set(
      configStore.models.map(
        (model) => `${model.name}@${model.provider?.id ?? ""}`,
      ),
    );

    return discoveredModels.filter((model) =>
      endpointModelIds.has(`${model.name}@${model.provider?.id ?? ""}`),
    );
  }, [
    accessStore.customModels,
    accessStore.defaultModel,
    configStore.customModels,
    configStore.models,
  ]);

  return models;
}
