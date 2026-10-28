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
        // slate/amber/teal are also built-in Tailwind color-scale names.
        // Registering them as a bare hex string (the old shape) replaces
        // the ENTIRE default 50-950 scale for that name instead of
        // extending it, so every slate-200/amber-50/teal-700-style class
        // anywhere in the app silently compiled to nothing. Spreading the
        // default scale back in and adding DEFAULT keeps bg-slate/
        // text-amber/etc. working as the brand color AND restores every
        // slate-*/amber-*/teal-* utility already used throughout the app.
        slate: { ...defaultColors.slate, DEFAULT: "#7A7F86" },
        amber: { ...defaultColors.amber, DEFAULT: "#C79C4B" },
        teal: { ...defaultColors.teal, DEFAULT: "#5E8F8D" }
      }
    }
  },
  plugins: []
};
