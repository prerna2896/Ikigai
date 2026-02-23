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
        slate: "#7A7F86",
        amber: "#C79C4B",
        teal: "#5E8F8D"
      }
    }
  },
  plugins: []
};
