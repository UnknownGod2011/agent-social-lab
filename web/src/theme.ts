import { useEffect, useState } from "react";

export type Theme = "dark" | "light" | "blue";
const next: Record<Theme, Theme> = {
  dark: "light",
  light: "blue",
  blue: "dark",
};
const backgrounds: Record<Theme, string> = {
  dark: "#111111",
  light: "#f5f5f3",
  blue: "#121926",
};
const key = "btt-theme";
function preference(value: string | null | undefined): Theme {
  return value === "light" || value === "blue" ? value : "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    preference(document.documentElement.dataset.theme),
  );
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === key || event.key === null)
        setTheme(preference(event.newValue));
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", backgrounds[theme]);
  }, [theme]);
  const nextTheme = next[theme];
  function toggleTheme() {
    try {
      localStorage.setItem(key, nextTheme);
    } catch {
      /* session only */
    }
    setTheme(nextTheme);
  }
  return { theme, nextTheme, toggleTheme };
}
