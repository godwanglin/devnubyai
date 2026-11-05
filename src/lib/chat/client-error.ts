/**
 * Marks the request id inside the stream error text. The client splits it back off and shows
 * it on the error card; the stored message keeps only the friendly line.
 *
 * Lives in its own module: the client imports it, and it must not pull in the server-only
 * generation code (sharp, the sandbox) that `generate.ts` depends on.
 */
export const CLIENT_ERROR_REQUEST_ID_PREFIX = "request-id: ";
