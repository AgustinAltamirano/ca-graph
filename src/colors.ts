// Categorical palette (validated reference palette, fixed slot order) and
// theme tokens for the WebGL canvas, which cannot read CSS variables.

const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export const SERIES_COUNT = SERIES_LIGHT.length;

export interface Theme {
  dark: boolean;
  series: string[];
  other: string;
  edge: string;
  edgeStrong: string;
  label: string;
  backdrop: string;
}

const LIGHT: Theme = {
  dark: false,
  series: SERIES_LIGHT,
  other: "#b4b2ab",
  edge: "#d6d4cd",
  edgeStrong: "#52514e",
  label: "#0b0b0b",
  backdrop: "#ffffff",
};

const DARK: Theme = {
  dark: true,
  series: SERIES_DARK,
  other: "#5e5d58",
  edge: "#3a3936",
  edgeStrong: "#c3c2b7",
  label: "#f0efec",
  backdrop: "#262624",
};

const query = window.matchMedia("(prefers-color-scheme: dark)");

export function currentTheme(): Theme {
  return query.matches ? DARK : LIGHT;
}

export function onThemeChange(cb: (t: Theme) => void) {
  query.addEventListener("change", () => cb(currentTheme()));
}
