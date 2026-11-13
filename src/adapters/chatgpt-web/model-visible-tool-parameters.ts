import type { CodexTool } from "../../types";

/** Expose only model-supplied inputs. The broker supplies durable IDs at native dispatch. */
export function modelVisibleToolParameters(tool: CodexTool): Record<string, unknown> {
  if (tool.freeform || tool.toolSearch) return tool.parameters;
  const hasOperationId = tool.parameters["x-codex-operation-id"] === true;
  const injectsEpoch = tool.parameters["x-codex-provider-epoch"] !== undefined;
  const hasReadOnlyContract = tool.parameters["x-codex-read-only"] !== undefined;
  const hasStatusContract = tool.parameters["x-codex-operation-status"] !== undefined;
  if (!hasOperationId && !injectsEpoch && !hasReadOnlyContract && !hasStatusContract) return tool.parameters;
  const parameters = structuredClone(tool.parameters);
  const properties = parameters.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const visibleProperties = properties as Record<string, unknown>;
    if (hasOperationId) delete visibleProperties.operation_id;
    if (injectsEpoch) delete visibleProperties.provider_epoch;
    if (Array.isArray(parameters.required)) {
      parameters.required = parameters.required.filter(value =>
        (!hasOperationId || value !== "operation_id") && (!injectsEpoch || value !== "provider_epoch"));
    }
  }
  delete parameters["x-codex-operation-id"];
  delete parameters["x-codex-provider-epoch"];
  delete parameters["x-codex-operation-status"];
  delete parameters["x-codex-read-only"];
  return parameters;
}
