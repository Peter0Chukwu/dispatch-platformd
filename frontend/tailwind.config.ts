import type { Config } from 'tailwindcss';

/**
 * DESIGN SYSTEM TOKENS
 * ─────────────────────────────────────────────────────────────────────────────
 * brand  : deep navy — the operational, trustworthy base (sidebars, headers)
 * accent : logistics green — action, success, "moving" states
 * The full scale exists so components never hardcode hex values.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EFF8F3', 100: '#D7EFE3', 200: '#AFDEC7', 300: '#7DC4A4',
          400: '#49A57D', 500: '#2C8A62', 600: '#1E7050', 700: '#175A41',
          800: '#114633', 900: '#0C3627', 950: '#072419',
        },
        accent: {
          50: '#ECFDF3', 100: '#D1FADF', 200: '#A6F4C5', 300: '#6CE9A6',
          400: '#32D583', 500: '#12B76A', 600: '#039855', 700: '#027A48',
          800: '#05603A', 900: '#054F31',
        },
        ink: {
          50: '#F8FAFC', 100: '#F1F5F9', 200: '#E2E8F0', 300: '#CBD5E1',
          400: '#94A3B8', 500: '#64748B', 600: '#475569', 700: '#334155',
          800: '#1E293B', 900: '#0F172A',
        },
        danger: { 50: '#FEF3F2', 100: '#FEE4E2', 200: '#FECDCA', 400: '#F97066', 500: '#F04438', 600: '#D92D20', 700: '#B42318' },
        warning: { 50: '#FFFAEB', 100: '#FEF0C7', 200: '#FEDF89', 400: '#FDB022', 500: '#F79009', 600: '#DC6803', 700: '#B54708' },
        info: { 50: '#EFF8FF', 100: '#D1E9FF', 200: '#B2DDFF', 400: '#53B1FD', 500: '#2E90FA', 600: '#1570EF', 700: '#175CD3' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem' },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.06), 0 1px 3px 0 rgb(16 24 40 / 0.10)',
        pop: '0 12px 32px -8px rgb(16 24 40 / 0.24)',
      },
      screens: { xs: '420px' },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in': { from: { opacity: '0', transform: 'translateX(16px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-in': 'slide-in 200ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
