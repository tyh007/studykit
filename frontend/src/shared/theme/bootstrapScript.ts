// Inline bootstrap script — runs before React mounts so the page never
// paints in the wrong theme. index.html injects `bootstrapScript` verbatim
// into a <script> tag in <head>.
//
// We intentionally do NOT use JSX or import anything from this file's
// neighbors — index.html does not go through TS, so this string has to
// be self-contained. Keep it tiny.

export const bootstrapScript = `(function () {
  try {
    var KEY = 'studykit.theme';
    var stored = null;
    try { stored = window.localStorage.getItem(KEY); } catch (e) { stored = null; }
    var pref = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var resolved = pref === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : pref;
    var root = document.documentElement;
    root.setAttribute('data-theme', resolved);
  } catch (e) {
    // Last-resort: leave data-theme unset so the @media system fallback applies.
  }
})();`;
