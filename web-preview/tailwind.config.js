/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0faf4',
          100: '#d9f2e3',
          200: '#b3e5c8',
          300: '#7dd0a6',
          400: '#4CAF82',
          500: '#2e9465',
          600: '#1f7550',
          700: '#1a5c3f',
          800: '#164832',
          900: '#103326',
        },
        surface: {
          900: '#0c1117',
          800: '#111827',
          700: '#1a2332',
          600: '#243040',
          500: '#2e3d52',
        }
      },
      animation: {
        'ping-slow': 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
        'spin-slow': 'spin 3s linear infinite',
        'pulse-soft': 'pulse 3s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}
