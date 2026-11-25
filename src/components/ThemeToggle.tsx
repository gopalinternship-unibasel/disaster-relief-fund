import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "relief-fund:theme";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "Theme follows the system", light: "Light theme", dark: "Dark theme" };

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyStoredTheme() {
  const t = readTheme();
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // storage blocked: the choice lasts until the page is reloaded
    }
  }, [theme]);
  return (
    <button type="button" className="iconbtn" onClick={() => setTheme(NEXT[theme])} aria-label={`${LABEL[theme]}. Change theme`} title={LABEL[theme]}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {theme === "light" ? (
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
          </g>
        ) : theme === "dark" ? (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        ) : (
          <g fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5Z" fill="currentColor" />
          </g>
        )}
      </svg>
    </button>
  );
}
