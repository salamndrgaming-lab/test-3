import { evidenceFieldPresence, type EvidenceBundle } from "@/lib/evidence/bundle";
import type { StripeEvidenceField } from "@/lib/evidence/reason-codes";
import type { DraftOutput } from "./schemas";

/**
 * Programmatic no-fabrication enforcement. The prompt forbids invention;
 * this verifies it: every submitted evidence value and every concrete
 * identifier in the narrative must be traceable to the evidence bundle.
 */

export interface ValidationViolation {
  type:
    | "field_not_in_bundle"
    | "value_not_in_bundle"
    | "narrative_artifact_not_in_bundle"
    | "empty_value"
    | "confidence_out_of_range";
  field?: string;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: ValidationViolation[];
}

/**
 * Free-text fields are composed prose (explanations, rebuttals) rather than
 * copied identifiers — for these we verify their embedded artifacts instead
 * of requiring the whole value to appear verbatim in the bundle.
 */
const FREE_TEXT_FIELDS: ReadonlySet<string> = new Set([
  "uncategorized_text",
  "duplicate_charge_explanation",
  "refund_refusal_explanation",
  "cancellation_rebuttal",
  "product_description",
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Flattens the bundle into one normalized haystack for provenance checks. */
export function bundleHaystack(bundle: EvidenceBundle): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (value == null) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    Object.values(value as Record<string, unknown>).forEach(walk);
  };
  walk(bundle);

  // Also index human formats of the money amounts (e.g. 12900 → "129.00")
  // so a narrative writing "$129.00" verifies against amount minor units.
  const amounts = [bundle.dispute.amount, bundle.charge.amount];
  for (const line of bundle.invoice?.lines ?? []) amounts.push(line.amount);
  for (const amount of amounts) {
    parts.push((amount / 100).toFixed(2));
  }

  return normalize(parts.join(" | "));
}

/**
 * Extracts concrete identifiers from prose that must be provable from the
 * bundle: emails, URLs, money amounts, and identifier-like tokens (tracking
 * numbers, Stripe ids, card last4 — alphanumerics with digits, length >= 6).
 */
export function extractArtifacts(text: string): string[] {
  const artifacts = new Set<string>();

  for (const match of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) {
    artifacts.add(match[0]);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s)"']+/g)) {
    artifacts.add(match[0]);
  }
  for (const match of text.matchAll(/(?:[$€£]\s?)(\d[\d,]*\.?\d{0,2})/g)) {
    artifacts.add(match[1].replace(/,/g, ""));
  }
  // Identifier-like tokens: contain a digit, length >= 6, not a pure number
  // shorter than 6 (avoids years/quantities), not a date fragment.
  for (const match of text.matchAll(/\b(?=\w*\d)[A-Za-z0-9_-]{6,}\b/g)) {
    const token = match[0];
    if (/^\d{4}-\d{2}-\d{2}/.test(token)) continue; // ISO dates checked via haystack anyway
    artifacts.add(token);
  }

  return [...artifacts];
}

export function validateDraftAgainstBundle(
  draft: DraftOutput,
  bundle: EvidenceBundle
): ValidationResult {
  const violations: ValidationViolation[] = [];
  const haystack = bundleHaystack(bundle);
  const presence = evidenceFieldPresence(bundle);

  if (draft.confidence < 0 || draft.confidence > 1) {
    violations.push({
      type: "confidence_out_of_range",
      detail: `confidence ${draft.confidence} outside [0, 1]`,
    });
  }

  for (const item of draft.evidenceSubmission) {
    const value = item.value.trim();
    if (value === "") {
      violations.push({
        type: "empty_value",
        field: item.field,
        detail: `${item.field} submitted with an empty value`,
      });
      continue;
    }

    if (FREE_TEXT_FIELDS.has(item.field)) {
      // Prose fields: verify embedded artifacts instead of the whole string.
      for (const artifact of extractArtifacts(value)) {
        if (!haystack.includes(normalize(artifact))) {
          violations.push({
            type: "value_not_in_bundle",
            field: item.field,
            detail: `${item.field} references "${artifact}" which does not appear in the evidence bundle`,
          });
        }
      }
      continue;
    }

    // Identifier fields must (a) be marked present for this bundle and
    // (b) have a value that literally appears in the bundle.
    if (!presence[item.field as StripeEvidenceField]) {
      violations.push({
        type: "field_not_in_bundle",
        field: item.field,
        detail: `${item.field} is not available in this evidence bundle (listed as a gap)`,
      });
      continue;
    }
    if (!haystack.includes(normalize(value))) {
      violations.push({
        type: "value_not_in_bundle",
        field: item.field,
        detail: `${item.field} value "${value}" does not appear in the evidence bundle`,
      });
    }
  }

  for (const artifact of extractArtifacts(draft.narrative)) {
    if (!haystack.includes(normalize(artifact))) {
      violations.push({
        type: "narrative_artifact_not_in_bundle",
        detail: `narrative references "${artifact}" which does not appear in the evidence bundle`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
