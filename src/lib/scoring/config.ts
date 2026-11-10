import "server-only";

import { env, type Env } from "@/lib/env";
import { decryptSecret, OPENAI_DECISIONS_KEY, SecretUnreadable, TYPESAFE_KEY } from "@/lib/secrets";
import type { SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { SCORING_KEY_MISSING, SCORING_KEY_UNREADABLE, type Scorer, type ScoringKeyState, type ScoringView } from "./scorers";

// What scores postings (#274): the choice saved in Settings → Scoring, or
// else DOSSIER_SCORER, or else the AI model; and Jev's key, saved there or
// in DOSSIER_TYPESAFE_KEY.

export type ScoringConfig = {
  scorer: Scorer;
  /** Whether the choice is saved in Settings, rather than coming from DOSSIER_SCORER or the default. */
  saved: boolean;
  key: string | null;
  keyState: ScoringKeyState;
};

const FROM_ENV: Record<NonNullable<Env["DOSSIER_SCORER"]>, Scorer> = { ai: "AI", jev: "JEV", "openai-decisions": "OPENAI_DECISIONS" };

export function resolveScoringConfig(
  saved: Pick<SettingsData, "scorer" | "typesafeKeyEnc"> & Partial<Pick<SettingsData, "openaiDecisionsKeyEnc">>,
  source: Pick<Env, "DOSSIER_SCORER" | "DOSSIER_TYPESAFE_KEY"> & Partial<Pick<Env, "DOSSIER_OPENAI_DECISIONS_KEY">>,
  secret?: string,
): ScoringConfig {
  const scorer = saved.scorer ?? (source.DOSSIER_SCORER ? FROM_ENV[source.DOSSIER_SCORER] : "AI");
  const choice = { scorer, saved: saved.scorer !== null };
  const decisions = scorer === "OPENAI_DECISIONS";
  const stored = decisions ? saved.openaiDecisionsKeyEnc : saved.typesafeKeyEnc;
  const supplied = decisions ? source.DOSSIER_OPENAI_DECISIONS_KEY : source.DOSSIER_TYPESAFE_KEY;
  if (stored) {
    try {
      return { ...choice, key: decryptSecret(decisions ? OPENAI_DECISIONS_KEY : TYPESAFE_KEY, stored, secret), keyState: "set" };
    } catch (error) {
      if (!(error instanceof SecretUnreadable)) throw error;
      return { ...choice, key: null, keyState: "unreadable" };
    }
  }
  return supplied ? { ...choice, key: supplied, keyState: "env" } : { ...choice, key: null, keyState: "none" };
}

/** The scoring configuration in effect right now. */
export async function loadScoringConfig(): Promise<ScoringConfig> {
  return resolveScoringConfig(await loadSettings(), env);
}

export const scoringView = (config: ScoringConfig): ScoringView => ({ scorer: config.scorer, keyState: config.keyState });

/** Jev's key, or why there isn't one, in words. */
export function jevKey({ key, keyState }: Pick<ScoringConfig, "key" | "keyState">): { key: string; problem: null } | { key: null; problem: string } {
  if (key) return { key, problem: null };
  return { key: null, problem: keyState === "unreadable" ? SCORING_KEY_UNREADABLE : SCORING_KEY_MISSING };
}

export function decisionsKey({ key, keyState }: Pick<ScoringConfig, "key" | "keyState">): { key: string; problem: null } | { key: null; problem: string } {
  if (key) return { key, problem: null };
  return { key: null, problem: keyState === "unreadable" ? "Your saved OpenAI Decisions key can't be read. Enter it again in Settings → Scoring." : "Enter your OpenAI API key in Settings → Scoring first." };
}
