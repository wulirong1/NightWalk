export const colors = {
  transparent: "transparent",
  black: "#000000",
  white: "#FFFFFF",
  background: "#F7F7F7",
  special: "#A6BAAE",
  specialSoft: "#E5ECE8",
  red: "#FF8080",
  surfaceMuted: "#F0F0F0",
  divider: "#E0E0E0",
  handle: "#B8B8B8",
};
const darkColors = {
  transparent: "transparent",
  black: "#000000",
  white: "#FFFFFF",
  background: "#121212",    // 🎯 夜間深色背景
  text: "#FFFFFF",          // 🎯 夜間白色文字
  textMuted: "#AAAAAA",     // 🎯 夜間副標題文字
  special: "#8FA397",       // 夜間微調的綠色
  specialSoft: "#2A332E",   // 夜間深綠色塊
  red: "#FF6666",
  surfaceMuted: "#1E1E1E",  // 夜間卡片背景
  divider: "#2C2C2C",
  handle: "#555555",
};
export const fontSizes = {
  caption: 10,
  footnote: 11,
  small: 12,
  labelSmall: 13,
  bodySmall: 14,
  body: 15,
  bodyLarge: 16,
  subtitle: 17,
  titleSmall: 18,
  titleMedium: 19,
  title: 20,
  titleLarge: 22,
  heading: 24,
  headingLarge: 28,
  display: 40,
  displayLarge: 44,
  successMark: 45,
};
export const themeColors = {
  light: colors,
  dark: darkColors,
};
export default function DummyThemeRoute() { return null; }