/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: '#E31E24',
        bg: '#0F0F10',
        surface: '#1A1A1A',
        panel: '#202124',
        border: '#3A3A3A',
        text: '#FFFFFF',
        'text-secondary': '#B5B5B5',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '0',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
