import { describe, expect, it } from "vitest";

import { APP_THEMES, parseAppTheme, parseColorScheme } from "./ui-preferences";

describe("browser appearance", () => {
  it("starts existing browsers in Studio and accepts only known theme names", () => {
    for (const value of [undefined, "", "unknown", "dark", '<script>']) expect(parseAppTheme(value)).toBe("studio");
    expect(parseAppTheme("studio")).toBe("studio");
    expect(parseAppTheme("editorial")).toBe("editorial");
    expect(APP_THEMES).toHaveLength(8);
    for (const theme of APP_THEMES) expect(parseAppTheme(theme)).toBe(theme);
  });

  it("keeps theme identity separate from the existing color-mode cookie", () => {
    expect(parseColorScheme("editorial")).toBeUndefined();
    expect(parseColorScheme("light")).toBe("light");
    expect(parseColorScheme("dark")).toBe("dark");
    expect(parseColorScheme("system")).toBeUndefined();
  });
});
