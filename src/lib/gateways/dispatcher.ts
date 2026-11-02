import type {
  DecryptedGatewayConfig,
  GatewayExecutionRequest,
  GatewayStreamEvent,
} from "./types";
import { executeChat } from "./adapters/chat";
import { executeResponses } from "./adapters/responses";
import { executeOAuthGateway } from "./oauth-dispatch";

function dispatchWireApi(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
): AsyncGenerator<GatewayStreamEvent> {
  if (gateway.wireApi === "responses") {
    return executeResponses(gateway, request);
  }
  return executeChat(gateway, request);
}

export function dispatchGatewayStream(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
): AsyncGenerator<GatewayStreamEvent> {
  if (gateway.authType === "oauth") {
    return executeOAuthGateway(gateway, request, dispatchWireApi);
  }
  return dispatchWireApi(gateway, request);
}
