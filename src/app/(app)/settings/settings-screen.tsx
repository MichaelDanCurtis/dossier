"use client";

import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { SavedIndicator } from "@/components/saved-indicator";
import { TrackSaveContext, useSaveTracker } from "@/components/save-tracker";
import { SectionPanel, SectionTabs } from "@/components/section-tabs";

import { SETTINGS_SECTIONS, settingsSectionHref, type SettingsSectionId } from "./sections";

/**
 * Settings sections share URL-backed tabs. Each control saves independently;
 * the header reports the aggregate save state.
 */
export function SettingsScreen({ section, children }: { section: SettingsSectionId; children: ReactNode }) {
  const saves = useSaveTracker();

  return (
    <TrackSaveContext value={saves.track}>
      <PageHeader
        title="Settings"
        description="It's your server, so it's your call. Choose which AI writes for you, set your document defaults, and take your data with you whenever you like."
        actions={section === "appearance" ? <span className="text-meta text-muted">Browser appearance</span> : <SavedIndicator status={saves.status} savedAt={saves.savedAt} />}
      />
      <div className="flex min-w-0 flex-col gap-7 px-5 pb-20 lg:px-10">
        <SectionTabs scope="settings" label="Settings sections" current={section}
          entries={SETTINGS_SECTIONS.map((entry) => ({ ...entry, href: settingsSectionHref(entry.id) }))} />
        <SectionPanel scope="settings" current={section} className="flex w-full max-w-[960px] flex-col gap-5">{children}</SectionPanel>
      </div>
    </TrackSaveContext>
  );
}

/** A section's title and introduction. */
export function SettingsSectionIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="font-heading text-section">{title}</h2>
      {children && <p className="text-sm text-pretty text-muted">{children}</p>}
    </div>
  );
}
