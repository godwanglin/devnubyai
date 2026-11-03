import type {
  DecryptedGatewayConfig,
  GatewayExecutionRequest,
  GatewayStreamEvent,
} from "./types";
import { executeChat } from "./adapters/chat";
import { executeResponses } from "./adapters/responses";
import { executeAntigravity } from "./adapters/antigravity";
import { executeClaude } from "./adapters/claude";
import { executeOAuthGateway } from "./oauth-dispatch";

function dispatchWireApi(
  gateway: DecryptedGatewayConfig,
  request: GatewayExecutionRequest
): AsyncGenerator<GatewayStreamEvent> {
  if (gateway.oauthProvider === "antigravity") {
    return executeAntigravity(gateway, request);
  }
  if (gateway.oauthProvider === "claude" || (gateway.wireApi as string) === "claude") {
    return executeClaude(gateway, request);
  }
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
