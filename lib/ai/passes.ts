import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import type { EvidenceBundle } from "@/lib/evidence/bundle";
import {
  buildDraftUserMessage,
  buildQAUserMessage,
  DRAFT_SYSTEM_PROMPT,
  QA_SYSTEM_PROMPT,
} from "./prompts";
import {
  draftOutputSchema,
  qaOutputSchema,
  type DraftOutput,
  type QAOutput,
} from "./schemas";

const DEFAULT_MODEL = "claude-opus-4-8";

let cachedClient: Anthropic | null = null;

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic {
  if (cachedClient) return cachedClient;
  cachedClient = new Anthropic();
  return cachedClient;
}

function model(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

/** Pass 1: draft the representment narrative + evidence mapping. */
export async function runDraftPass(bundle: EvidenceBundle): Promise<DraftOutput> {
  const response = await client().messages.parse({
    model: model(),
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: DRAFT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    output_config: {
      effort: "high",
      format: zodOutputFormat(draftOutputSchema),
    },
    messages: [{ role: "user", content: buildDraftUserMessage(bundle) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("draft pass refused by model safety systems");
  }
  if (!response.parsed_output) {
    throw new Error(`draft pass returned unparseable output (stop: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

/** Pass 2: adversarial QA as the card-network reviewer. */
export async function runQAPass(
  bundle: EvidenceBundle,
  draft: DraftOutput
): Promise<QAOutput> {
  const response = await client().messages.parse({
    model: model(),
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: QA_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    output_config: {
      effort: "high",
      format: zodOutputFormat(qaOutputSchema),
    },
    messages: [
      {
        role: "user",
        content: buildQAUserMessage(bundle, {
          narrative: draft.narrative,
          evidenceSubmission: draft.evidenceSubmission,
          gapHandling: draft.gapHandling,
        }),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("QA pass refused by model safety systems");
  }
  if (!response.parsed_output) {
    throw new Error(`QA pass returned unparseable output (stop: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
