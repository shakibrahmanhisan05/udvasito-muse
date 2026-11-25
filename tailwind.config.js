/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#C1121F",
        primaryPressed: "#A50F1A",
        primarySoft: "#FDECEE",
        logoRed: "#E63946",
        navy: "#1D3557",
        ink: "#111827",
        muted: "#4B5563",
        surface: "#F6F7F9",
      },
      fontFamily: {
        sans: ["NotoSans_400Regular"],
        bengali: ["NotoSansBengali_400Regular"],
      },
    },
  },
  plugins: [],
};
