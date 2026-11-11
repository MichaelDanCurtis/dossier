import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_THEMES } from "./ui-preferences";

const css = readFileSync("public/ui-themes.css", "utf8");
const variables = (text: string) => Object.fromEntries([...text.matchAll(/(--ui-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const base = variables(css.slice(css.indexOf("{"), css.indexOf("}")));
function luminance(hex: string) {
  const rgb = hex.replace("#", "").match(/../g)!.map((n) => parseInt(n, 16) / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
describe("readable app palettes", () => {
  for (const theme of APP_THEMES) for (const [index, mode] of ["light", "dark"].entries()) it(`${theme} ${mode} keeps text and buttons readable`, () => {
    const marker = `[data-ui-theme="${theme}"]`;
    const start = css.indexOf("{", css.indexOf(marker));
    const values = { ...base, ...variables(css.slice(start, css.indexOf("}", start))) };
    const resolve = (key: string): string => {
      const value = values[key];
      const alias = value.match(/^var\((--[^)]+)\)$/);
      if (alias) return resolve(alias[1]);
      const pair = value.match(/^light-dark\((#[a-f0-9]{6}), (#[a-f0-9]{6})\)$/i);
      return pair ? pair[index + 1] : value;
    };
    for (const [fg, bg] of [["color-ink", "color-card"], ["color-muted", "color-card"], ["color-on-primary", "color-primary"], ["sidebar-ink", "color-sidebar"], ["sidebar-ink", "sidebar-selected"]]) {
      const a = luminance(resolve(`--ui-${fg}`)), b = luminance(resolve(`--ui-${bg}`));
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${fg} over ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
