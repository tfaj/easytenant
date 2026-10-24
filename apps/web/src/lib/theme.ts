import { useEffect, useState } from "react";

export type ThemeChoice = "auto" | "light" | "dark";
const KEY = "et-theme";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0E1618" : "#0F6E5B");
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => {
    apply(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* private mode */
    }
    if (choice !== "auto") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("auto");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);
  return [choice, setChoice] as const;
}
