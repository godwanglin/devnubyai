export interface ExtractorResult {
  success: boolean;
  text: string;
  pageOrSheetCount?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}
