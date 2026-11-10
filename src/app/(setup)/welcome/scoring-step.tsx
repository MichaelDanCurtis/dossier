"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TYPESAFE_KEY_URL, type Scorer, type ScoringView } from "@/lib/scoring/scorers";
import { WIKI } from "@/lib/setup/instructions";

import { saveScorer, saveTypesafeKey, saveOpenaiDecisionsKey, testJev, testOpenaiDecisions } from "../../(app)/settings/actions";
import { ChoiceCards } from "./choice-cards";
import { InstructionList } from "./instruction-list";

type Status = { state: "idle" } | { state: "checking" } | { state: "connected" } | { state: "failed"; message: string };

const OPTIONS: readonly { value: Scorer; name: string; description: string; tag: string }[] = [
  {
    value: "AI",
    name: "Your AI",
    description: "The AI you chose scores each posting and says in its own words why it fits. Nothing more to set up.",
    tag: "Recommended",
  },
  {
    value: "JEV",
    name: "Jev by TypeSafe",
    description: "A model made for quick yes-or-no judgments. CareerAI builds the score from its answers, and the reasons quote the posting's own lines.",
    tag: "Needs a TypeSafe key · in early access",
  },
  {
    value: "OPENAI_DECISIONS",
    name: "OpenAI Decisions",
    description: "GPT-6 Luna evaluates a job-fit rubric. CareerAI builds the score and reasons from its typed answers.",
    tag: "Needs an OpenAI API key",
  },
];

/**
 * The guide's scoring step (E21-4): Score in Find jobs and the job agent use
 * your AI unless you choose Jev, which comes with its key steps and a check.
 */
export function ScoringStep({ initial }: { initial: ScoringView }) {
  const router = useRouter();
  const [scorer, setScorer] = useState<Scorer>(initial.scorer);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const choose = async (next: Scorer) => {
    setScorer(next);
    setKey("");
    setStatus({ state: "idle" });
    if (toastResult(await saveScorer({ scorer: next })).ok) router.refresh();
  };

  const check = async () => {
    setStatus({ state: "checking" });
    if (key.trim() && !toastResult(await (scorer === "OPENAI_DECISIONS" ? saveOpenaiDecisionsKey : saveTypesafeKey)({ change: { action: "set", value: key } })).ok) return setStatus({ state: "idle" });
    const result = toastResult(await (scorer === "OPENAI_DECISIONS" ? testOpenaiDecisions : testJev)({}));
    if (!result.ok) return setStatus({ state: "idle" });
    if (!result.data.connected) return setStatus({ state: "failed", message: result.data.message });
    setKey("");
    setStatus({ state: "connected" });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-8">
      <ChoiceCards label="Score postings with" options={OPTIONS} value={scorer} onChange={(next) => void choose(next)} />
      {(scorer === "JEV" || scorer === "OPENAI_DECISIONS") && (
        <Card className="flex flex-col gap-6">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="font-medium">What it costs</dt>
            <dd className="text-pretty text-muted">{scorer === "OPENAI_DECISIONS" ? "OpenAI API usage is charged to your own key. This choice uses GPT-6 Luna through the Decisions API." : "You pay TypeSafe for each posting it reads. It’s in early access, so a new account may have to wait for a key."}</dd>
            <dt className="font-medium">Your data</dt>
            <dd className="text-pretty text-muted">
              {scorer === "OPENAI_DECISIONS" ? "Each posting you score goes to OpenAI with profile evidence, without your name, contact fields or references. Your key is stored encrypted for your account." : "Each posting you score goes to TypeSafe with your profile, without your name, contact details or references. TypeSafe doesn’t train on it. Jev reads English best."}
            </dd>
          </dl>
          <InstructionList
            label={scorer === "OPENAI_DECISIONS" ? "Setting up OpenAI Decisions" : "Setting up Jev"}
            steps={[
              scorer === "OPENAI_DECISIONS" ? { text: "Create an OpenAI API key with Decisions API access.", link: { href: "https://platform.openai.com/api-keys", label: "the OpenAI platform" } } : { text: "Sign up for TypeSafe, then open the console's keys and create one.", link: { href: TYPESAFE_KEY_URL, label: "the TypeSafe console" } },
              { text: "Copy the key and paste it below." },
            ]}
          />
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (status.state !== "checking") void check();
            }}
          >
            <Input
              label={scorer === "OPENAI_DECISIONS" ? "OpenAI API key for Decisions" : "TypeSafe key"}
              type="password"
              autoComplete="off"
              placeholder={initial.keyState === "set" ? "Saved · paste a new one to replace it" : "Paste it here"}
              hint="Stored encrypted on your server, and never shown again."
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <Button type="submit" className="self-start" aria-disabled={status.state === "checking" || undefined}>
              {status.state === "checking" ? "Checking…" : "Check it"}
            </Button>
          </form>
          <div role="status" className="text-sm empty:hidden">
            {status.state === "connected" && <p className="text-success">It works: {scorer === "OPENAI_DECISIONS" ? "OpenAI Decisions" : "Jev"} answered.</p>}
            {status.state === "failed" && <p className="rounded-card bg-warning-surface px-4 py-3 font-medium text-warning">{status.message}</p>}
          </div>
          <a href={scorer === "OPENAI_DECISIONS" ? "https://developers.openai.com/api/docs/guides/decisions" : `${WIKI}/Choosing-an-AI-provider#scoring-with-jev`} target="_blank" rel="noopener noreferrer" className="self-start text-meta text-muted underline underline-offset-2 hover:text-ink">
            More help <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Card>
      )}
    </div>
  );
}
