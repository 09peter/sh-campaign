/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: '#101208',
        slate2: '#181B10',
        panel: '#1E2214',
        line: '#3A3F2A',
        bone: '#E5E0C8',
        ash: '#8B876F',
        imperial: '#A62B21',
        emberlight: '#D0483A',
        brass: '#C0983E',
        brasslight: '#E0BE6A',
        olive: '#4C5238',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'sans-serif'],
        body: ['Barlow', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
