"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { APP_THEMES, APP_THEME_DETAILS as THEMES, browserAppearance, previewAppearance, saveAppearance, type Appearance, type ColorScheme } from "@/lib/ui-preferences";

import { SettingsSectionIntro } from "./settings-screen";
import styles from "./appearance-section.module.css";

/** Preview the real UI; only Apply writes browser preferences. Never touches a document theme. */
export function AppearanceSection({ initial }: { initial: Appearance }) {
  const [saved, setSaved] = useState(initial);
  const [chosen, setChosen] = useState(initial);
  const [message, setMessage] = useState("");
  const changed = chosen.theme !== saved.theme || chosen.scheme !== saved.scheme;

  useEffect(() => {
    const committed = () => {
      const appearance = browserAppearance();
      setSaved(appearance);
      // A quick sidebar mode change must not silently accept a draft theme.
      setChosen((draft) => ({ ...draft, scheme: appearance.scheme }));
    };
    window.addEventListener("dossier:appearance-saved", committed);
    return () => {
      window.removeEventListener("dossier:appearance-saved", committed);
      previewAppearance(browserAppearance());
    };
  }, []);

  const preview = (next: Appearance) => {
    setChosen(next);
    setMessage("");
    previewAppearance(next);
  };
  const apply = () => {
    saveAppearance(chosen);
    setSaved(chosen);
    setMessage(`${THEMES[chosen.theme].name} applied. This browser will remember your appearance.`);
  };
  const cancel = () => {
    const appearance = browserAppearance();
    setChosen(appearance);
    setSaved(appearance);
    previewAppearance(appearance);
    setMessage("Preview cancelled.");
  };

  return (
    <>
      <SettingsSectionIntro title="Appearance">
        Eight color palettes, each with light and dark modes. Preview the app before applying a choice. Sign-in and user management use the same palette; resume document themes are separate.
      </SettingsSectionIntro>
      <fieldset className="rounded-panel border border-line-card bg-card p-5">
        <legend className="px-1 text-sm font-medium">Color mode</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {([undefined, "light", "dark"] as const).map((scheme) => (
            <label key={scheme ?? "system"} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="color-scheme" checked={chosen.scheme === scheme} onChange={() => preview({ ...chosen, scheme: scheme as ColorScheme | undefined })} className="size-4 accent-primary" />
              {scheme === undefined ? "Follow system" : scheme === "light" ? "Light" : "Dark"}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-sm font-medium">App theme</legend>
        <div className="grid gap-4 min-[620px]:grid-cols-2 min-[1400px]:grid-cols-3">
          {APP_THEMES.map((theme) => (
            <label key={theme} className="relative min-w-0 cursor-pointer">
              <input className="peer sr-only" type="radio" name="app-theme" value={theme} checked={chosen.theme === theme} onChange={() => preview({ ...chosen, theme })} />
              <span className="flex h-full flex-col gap-3 rounded-panel border border-line-input bg-card p-4 peer-checked:border-primary-text peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-focus">
                <span className="grid grid-cols-2 gap-2" aria-hidden="true">
                  {(["light", "dark"] as const).map((mode) => <span key={mode} className="space-y-1"><span className="block text-xs text-muted">{mode === "light" ? "Light" : "Dark"}</span><span data-ui-theme={theme} data-preview-mode={mode} className={styles.preview}>
                    <span className={styles.sidebar}><span>C</span><i /><i /><i /></span>
                    <span className={styles.page}><b>Career</b><span className={styles.miniCard}><b>Aa</b><i /><i /></span><span className={styles.miniAction}>Continue</span></span>
                  </span></span>)}
                </span>
                <span className="flex items-center justify-between gap-2 font-medium">{THEMES[theme].name}{theme === "studio" && <span className="ml-auto text-xs text-muted">Default</span>}{chosen.theme === theme && <Check size={16} aria-label="Selected" className="shrink-0 text-primary-text" />}</span>
                <span className="text-sm text-muted">{THEMES[theme].description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-line bg-paper py-4">
        <Button onClick={apply} disabled={!changed}>Apply appearance</Button>
        <Button variant="secondary" onClick={cancel} disabled={!changed}>Cancel preview</Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted">{changed ? `Previewing ${THEMES[chosen.theme].name}. Apply to keep these changes.` : message || `${THEMES[saved.theme].name} is your saved theme.`}</p>
    </>
  );
}
