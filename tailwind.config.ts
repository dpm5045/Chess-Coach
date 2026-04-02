import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f1419",
          card: "#1a1f2e",
          elevated: "#242b3d",
        },
        accent: {
          green: "#4CAF50",
          red: "#f44336",
          yellow: "#FFD700",
          orange: "#FF9800",
          blue: "#2196F3",
        },
      },
    },
  },
  plugins: [],
};
export default config;
