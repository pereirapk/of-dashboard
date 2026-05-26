export interface CategorizationResult {
  transactionId: string;        // mongo _id as hex
  category: string;             // category slug from CATEGORY_SLUGS
  source: "mcc" | "llm";
  confidence?: number;          // 0..1, only for LLM
}
