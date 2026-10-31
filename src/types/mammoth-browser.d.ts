declare module "mammoth/mammoth.browser" {
  export interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: Record<string, unknown>
  ): Promise<MammothResult>;

  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<MammothResult>;
}
