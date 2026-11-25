import '@testing-library/jest-dom/vitest'

// WP-08 Round 2: install `fake-indexeddb` so the
// Dexie outbox (v9) works under happy-dom. The
// production build opens the real IndexedDB in the
// browser; tests use the in-memory fake so the
// outbox can be exercised end-to-end. The
// `auto` entry sets up the `IDBFactory` /
// `IDBKeyRange` polyfills on `globalThis` for
// every test in the run.
import 'fake-indexeddb/auto'

// WP-07 Round 4 P0-1: enable React's act() across
// the test suite. `globalThis.IS_REACT_ACT_ENVIRONMENT`
// must be `true` so React's internal `act()` calls
// (inside `react-dom/cjs/react-dom-profiling.development.js`
// `isConcurrentActEnvironment`) recognise the test
// environment and skip the
//   "The current testing environment is not configured
//    to support act(...)"
// warning. The flag is set on globalThis at module load;
// the test file's `beforeEach` re-asserts it (in case a
// userEvent v14 dispatch path toggles it locally).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom doesn't set a doctype; KaTeX emits warnings about
// quirks mode and the legacy build. We override the document's
// `compatMode` and `doctype` getters so KaTeX stops complaining
// without us having to silence warnings at the console layer.
//
// Note: we *intentionally* do NOT filter React's "was not
// wrapped in act" warning. React warnings must surface in the
// test output; if a test triggers one, the test (or the code
// under test) needs to be fixed, not papered over (WP-02 Gate
// §3 blocker 1).
if (typeof document !== 'undefined') {
  try {
    Object.defineProperty(document, 'compatMode', {
      configurable: true,
      get() {
        return 'CSS1Compat';
      },
    });
  } catch {
    /* ignore */
  }
  try {
    Object.defineProperty(document, 'doctype', {
      configurable: true,
      get() {
        return { name: 'html', publicId: '', systemId: '' } as DocumentType;
      },
    });
  } catch {
    /* ignore */
  }
}

const KATEX_NOISE = [
  "KaTeX doesn't work in quirks mode",
  'Please use the `legacy` build in Node.js environments',
];
const originalWarn = console.warn;
const originalLog = console.log;
// eslint-disable-next-line no-console
console.warn = (...args: unknown[]) => {
  const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  if (KATEX_NOISE.some((needle) => text.includes(needle))) return;
  originalWarn.apply(console, args);
// eslint-disable-next-line no-console
};
// pdfjs-dist's modern build uses `console.log` for the "use
// the legacy build" warning. Filter it here too.
console.log = (...args: unknown[]) => {
  const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  if (KATEX_NOISE.some((needle) => text.includes(needle))) return;
  originalLog.apply(console, args);
};

// pdfjs-dist sometimes writes through a captured
// `process.stdout.write`; intercept at the byte level.
const _origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  const text = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString() : String(chunk);
  if (KATEX_NOISE.some((needle) => text.includes(needle))) return true;
  return (_origStdoutWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;
