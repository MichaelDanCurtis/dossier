import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SettingsSectionIntro } from "./settings-screen";

export type AboutFacts = { label: string; value: string }[];

/** CareerAI installation details and the setup guide. */
export function AboutSection({ facts }: { facts: AboutFacts }) {
  return (
    <>
      <SettingsSectionIntro title="About this install">CareerAI is our private fork of Dossier. Free and open source under AGPL-3.0.</SettingsSectionIntro>
      <Card padding="none" className="px-7 py-2">
        <dl>
          {facts.map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-4 border-t border-line py-3.5 text-sm first:border-t-0">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right font-mono text-[13px] [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card padding="none" className="flex flex-wrap items-center justify-between gap-3 px-7 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Setup guide</span>
          <span className="text-meta text-muted">Walks through the AI, job search, scoring, Gmail and Calendar, and your profile, one step at a time.</span>
        </div>
        <Link href="/welcome?step=start" className={buttonClassName("secondary", "sm")}>
          Open the setup guide
        </Link>
      </Card>
    </>
  );
}
