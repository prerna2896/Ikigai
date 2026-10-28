const defaultColors = require("tailwindcss/colors");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sage: "#8EA38E",
        dusty_blue: "#7D8FA3",
        mauve: "#A58AA5",
        warm_rose: "#B68986",
        slate: { ...defaultColors.slate, DEFAULT: "#7A7F86" },
        amber: { ...defaultColors.amber, DEFAULT: "#C79C4B" },
        teal: { ...defaultColors.teal, DEFAULT: "#5E8F8D" }
      }
    }
  },
  plugins: []
};
