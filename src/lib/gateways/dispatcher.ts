import type {
  DecryptedGatewayConfig,
  GatewayExecutionRequest,
  GatewayStreamEvent,
} from "./types";
import { executeChat } from "./adapters/chat";
import { executeResponses } from "./adapters/responses";

export function dispatchGatewayStream(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
): AsyncGenerator<GatewayStreamEvent> {
  if (gateway.wireApi === "responses") {
    return executeResponses(gateway, request);
  }
  return executeChat(gateway, request);
}
