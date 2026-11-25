// Public entry point for the theme runtime.
//
// NOTE: ThemeSwitcher intentionally lives in `app/`, not here.
// `shared/` must not import from `components/`, and the switcher
// renders legacy icons from `components/ui/Icons`. Consumers
// should import ThemeSwitcher from `app/`.

export {
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  toDataTheme,
  type ThemePreference,
  type ResolvedTheme,
} from './types';
export {
  createLocalStorageThemeStorage,
  createInMemoryThemeStorage,
  type ThemeStorage,
} from './storage';
export {
  createMatchMediaSystemThemeSource,
  createFakeSystemThemeSource,
  type SystemThemeSource,
} from './systemTheme';
export {
  ThemeProvider,
  useTheme,
  useResolvedTheme,
  type ThemeContextValue,
  type ThemeProviderProps,
  type ThemeRuntimeAdapters,
} from './ThemeProvider';
export { bootstrapScript } from './bootstrapScript';
