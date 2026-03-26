import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Momentrix dark theme palette (from GAS dashboard.html)
        mx: {
          bg: '#0B0F1A',
          topbar: '#111827',
          card: '#161E2E',
          border: '#1F2D45',
          'border-light': '#334155',
          text: '#E2E8F0',
          'text-secondary': '#94A3B8',
          'text-muted': '#64748B',
          'text-dim': '#475569',
          blue: '#3B82F6',
          cyan: '#06B6D4',
          green: '#10B981',
          amber: '#F59E0B',
          red: '#E74C3C',
          'red-light': '#F87171',
          purple: '#A78BFA',
          'purple-dark': '#7C3AED',
          'purple-mid': '#8B5CF6',
          indigo: '#6366F1',
        },
      },
      fontFamily: {
        sans: ["'Apple SD Gothic Neo'", "'Malgun Gothic'", 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
