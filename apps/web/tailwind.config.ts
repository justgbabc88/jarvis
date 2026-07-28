import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Arc-reactor HUD palette
        ink: "#04080f",
        panel: "#0a131f",
        panel2: "#0e1a2a",
        line: "#163a52",
        accent: "#2dd4ff",   // reactor cyan
        accent2: "#ffb454",  // Stark gold
        muted: "#7e93a8",
        good: "#34e5b0",
        bad: "#ff5d6c",
        warn: "#ffc24b",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ['"Share Tech Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        display: ['"Orbitron"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(45,212,255,0.30), 0 0 26px -4px rgba(45,212,255,0.45)",
        "glow-sm": "0 0 0 1px rgba(45,212,255,0.22), 0 0 12px -2px rgba(45,212,255,0.35)",
      },
      keyframes: {
        "reactor-pulse": {
          "0%,100%": { opacity: "0.5", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.12)" },
        },
        scan: {
          "0%": { transform: "translateY(-5vh)", opacity: "0" },
          "10%,90%": { opacity: "1" },
          "100%": { transform: "translateY(100vh)", opacity: "0" },
        },
        flicker: {
          "0%,100%": { opacity: "1" },
          "45%": { opacity: "0.55" },
          "55%": { opacity: "0.85" },
        },
      },
      animation: {
        "reactor-pulse": "reactor-pulse 2.4s ease-in-out infinite",
        scan: "scan 9s linear infinite",
        flicker: "flicker 3.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
