import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0a0b10",
        panel: "#13141c",
        panel2: "#1a1c27",
        line: "#262838",
        accent: "#7c5cff",
        accent2: "#36e0c8",
        muted: "#8b8fa3",
        good: "#36d399",
        bad: "#f87272",
        warn: "#fbbd23",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,92,255,0.25), 0 8px 40px -12px rgba(124,92,255,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
