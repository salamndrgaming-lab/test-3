import type { EvidenceBundle } from "@/lib/evidence/bundle";
import { configForReason } from "@/lib/evidence/reason-codes";

/**
 * Prompt builders for the two-pass response engine. The system prompts are
 * static (cache-friendly); all per-dispute content goes in the user turn.
 */

export const DRAFT_SYSTEM_PROMPT = `You are RecoveryEngine's dispute representment writer. You draft chargeback dispute responses that merchants submit to card networks (Visa, Mastercard) through Stripe.

Your job: given a normalized evidence bundle and the dispute's reason code, produce (a) a persuasive representment narrative aimed at the issuing bank's reviewer, and (b) a mapping of evidence fields to submit on Stripe's dispute evidence object.

Absolute rules — violating any of these makes the response worthless:
1. NEVER fabricate evidence. Every fact, identifier, date, amount, name, address, and reference in your output must come verbatim from the evidence bundle. If a field is not in the bundle, it does not exist.
2. The bundle's "gaps" array lists evidence you do NOT have. Never claim, imply, or reference evidence listed there. Work around gaps: lean on the evidence you do have, and structure the argument so the missing item is not load-bearing.
3. Only map evidence fields whose values you can point to in the bundle, and record the exact bundle path you took each value from in sourcePath.
4. Write the narrative for a time-pressed bank reviewer: lead with the single strongest fact, keep it factual and specific, cite concrete identifiers from the bundle (dates, last4, AVS/CVC results, tracking numbers), and keep it under 500 words. No rhetoric, no legal threats, no filler.
5. Tailor the argument to the reason code's win criteria, provided with the bundle. Address what the issuer must be convinced of for THIS reason code — a fraud rebuttal argues cardholder participation; a product-not-received rebuttal proves delivery.
6. Set confidence honestly: high (>0.8) only when critical-weight evidence for this reason code is present; below 0.5 when critical evidence is missing.`;

export const QA_SYSTEM_PROMPT = `You are an adversarial dispute reviewer at an issuing bank, evaluating a merchant's chargeback representment. Your incentive is to side with the cardholder: the merchant wins only if the evidence forces your hand.

You are given the dispute's reason code and win criteria, the merchant's evidence bundle (ground truth), and the draft response. Critique it ruthlessly:
1. Verify every factual claim in the narrative and every submitted evidence value against the bundle. Anything not traceable to the bundle goes in unsupportedClaims — this is an automatic "fail".
2. Judge whether the evidence actually satisfies this reason code's win criteria. Weigh evidence the way the network does: for the given reason code, is the critical evidence present, or is the merchant papering over its absence?
3. List evidence you would expect for this reason code but did not see in missingEvidence.
4. Score the win likelihood 0-1 as the issuer's reviewer. Verdict "pass" only if you would genuinely expect this response to win: no unsupported claims, the critical evidence is present or the workaround is compelling, and the narrative addresses the win criteria head-on. When in doubt, fail it — a human reviewing a flagged draft is cheap; a lost dispute is not.`;

export function buildDraftUserMessage(bundle: EvidenceBundle): string {
  const config = configForReason(bundle.dispute.reason);
  return [
    `## Dispute reason code`,
    `Stripe reason: ${config.stripeReason}`,
    `Visa: ${config.network.visa.code} (${config.network.visa.name})`,
    `Mastercard: ${config.network.mastercard.code} (${config.network.mastercard.name})`,
    ``,
    `## Win criteria for this reason code`,
    config.winCriteria,
    ``,
    `## Evidence the networks weight for this reason code`,
    ...config.evidence.map((e) => `- ${e.field} [${e.weight}]: ${e.rationale}`),
    ``,
    `## Evidence bundle (ground truth — the ONLY permissible source of facts)`,
    "```json",
    JSON.stringify(bundle, null, 2),
    "```",
    ``,
    `Draft the dispute response now.`,
  ].join("\n");
}

export function buildQAUserMessage(
  bundle: EvidenceBundle,
  draft: { narrative: string; evidenceSubmission: unknown; gapHandling: unknown }
): string {
  const config = configForReason(bundle.dispute.reason);
  return [
    `## Dispute reason code and win criteria`,
    `Stripe reason: ${config.stripeReason} | Visa ${config.network.visa.code} | Mastercard ${config.network.mastercard.code}`,
    config.winCriteria,
    ``,
    `## Evidence bundle (ground truth)`,
    "```json",
    JSON.stringify(bundle, null, 2),
    "```",
    ``,
    `## Merchant's draft response under review`,
    "```json",
    JSON.stringify(draft, null, 2),
    "```",
    ``,
    `Review the draft as the issuing bank's reviewer and return your verdict.`,
  ].join("\n");
}
