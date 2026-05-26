import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { TransactionDoc } from "@/lib/repositories/transactions";
import type { CategorizationResult } from "./types";
import { CATEGORY_SLUGS } from "@/lib/seed/categories";

export interface LlmCategorizerOptions {
  batchSize?: number; // default 50
}

// ---------------------------------------------------------------------------
// Zod schema for Claude's response
// ---------------------------------------------------------------------------

const CategorizationItemSchema = z.object({
  transactionId: z.string(),
  category: z.string(),
  confidence: z.number().min(0).max(1),
});

const ClaudeResponseSchema = z.object({
  categorizations: z.array(CategorizationItemSchema),
});

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

const VALID_SLUGS_LIST = Array.from(CATEGORY_SLUGS).join(", ");

const SYSTEM_PROMPT = `You are a financial transaction categorizer for Brazilian bank transactions.

Your task is to classify each transaction into exactly one of the following category slugs:
${VALID_SLUGS_LIST}

Rules:
- Respond ONLY with valid JSON in the exact schema specified below. No markdown, no explanation.
- For each transaction, choose the single most appropriate category slug.
- Assign a confidence score between 0 and 1.
- If you are not confident (below 0.7), still make your best guess but reflect that in the confidence score.

Required JSON response schema:
{
  "categorizations": [
    { "transactionId": "<hex string>", "category": "<slug>", "confidence": <number 0..1> }
  ]
}`;

function txToLine(tx: TransactionDoc & { category?: string | null }): string {
  const fields: Record<string, unknown> = {
    transactionId: tx._id.toHexString(),
    description: tx.description,
    amount: tx.amount,
    source: tx.source,
  };
  if (tx.mcc != null) fields.mcc = tx.mcc;
  if (tx.category) fields.category = tx.category;
  return JSON.stringify(fields);
}

function buildFewShotBlock(fewShot: TransactionDoc[]): string {
  if (fewShot.length === 0) return "(no examples provided)";
  return fewShot.map((tx) => txToLine(tx)).join("\n");
}

function buildBatchBlock(batch: TransactionDoc[]): string {
  return batch.map((tx) => txToLine(tx)).join("\n");
}

// ---------------------------------------------------------------------------
// Per-chunk call
// ---------------------------------------------------------------------------

async function classifyChunk(
  client: Anthropic,
  fewShot: TransactionDoc[],
  chunk: TransactionDoc[]
): Promise<CategorizationResult[]> {
  const fewShotText = buildFewShotBlock(fewShot);
  const batchText = buildBatchBlock(chunk);

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        // Block 1 (cached): static rules + valid category slugs.
        // This prefix is stable across all requests for this deployment.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            // Block 2 (cached): per-user few-shot context.
            // Changes only when the user categorizes new transactions;
            // hits the cache for re-runs within the 5-minute TTL.
            text: `Previously categorized transactions (use as examples):\n${fewShotText}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            // Block 3 (NOT cached): the specific batch being classified this turn.
            text: `Transactions to categorize:\n${batchText}`,
          },
        ],
      },
    ],
  });

  // Extract text content
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("[categorize-llm] no text block in response");
  }

  // Parse JSON
  const parsed = JSON.parse(textBlock.text);

  // Validate with Zod
  const validated = ClaudeResponseSchema.parse(parsed);

  // Filter and map results
  const results: CategorizationResult[] = [];
  for (const item of validated.categorizations) {
    // Drop rows where confidence < 0.7 or category slug is unknown
    if (item.confidence < 0.7) continue;
    if (!CATEGORY_SLUGS.has(item.category)) continue;

    results.push({
      transactionId: item.transactionId,
      category: item.category,
      source: "llm",
      confidence: item.confidence,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Categorize a batch of uncategorized transactions via Claude Haiku.
 *
 * - Returns one CategorizationResult per row Claude classifies with
 *   confidence >= 0.7.
 * - Rows with lower confidence or unknown category slugs are dropped (caller
 *   leaves them uncategorized).
 * - If ANTHROPIC_API_KEY is missing OR the SDK call throws, returns []
 *   silently. Errors are logged to stderr but never thrown.
 * - Splits inputs into chunks of `batchSize` and calls Claude per chunk.
 */
export async function categorizeByLlm(
  uncategorized: TransactionDoc[],
  fewShot: TransactionDoc[],
  opts?: LlmCategorizerOptions
): Promise<CategorizationResult[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return [];
  }

  if (uncategorized.length === 0) {
    return [];
  }

  const batchSize = opts?.batchSize ?? 50;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const results: CategorizationResult[] = [];

  // Split into chunks
  for (let i = 0; i < uncategorized.length; i += batchSize) {
    const chunk = uncategorized.slice(i, i + batchSize);
    try {
      const chunkResults = await classifyChunk(client, fewShot, chunk);
      results.push(...chunkResults);
    } catch (err) {
      console.error("[categorize-llm] error:", err instanceof Error ? err.message : String(err));
      // Return whatever we have so far; failed chunks contribute nothing
      return results;
    }
  }

  return results;
}
