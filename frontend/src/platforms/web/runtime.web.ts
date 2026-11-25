/**
 * StudyKit v0.4 — `platforms/web/runtime.web`
 *
 * The Web-side `RuntimeCapabilities` adapter. This is the value
 * the product sees when running in a normal browser tab, inside a
 * PWA, or inside the WebView of a Tauri build that has not yet
 * wired the desktop adapter (none of which is true for WP-09A,
 * but the layering is in place).
 *
 * Detection rule: any global `window` object that is not Tauri
 * counts as web. The desktop adapter (`platforms/desktop/runtime.desktop`)
 * is the one that recognises the Tauri internals. Both adapters
 * are loaded eagerly by `platforms/runtime.ts`, which keeps a
 * single resolved snapshot.
 *
 * Platform identification is best-effort UA parsing. It is for
 * diagnostics only — application code must NOT branch on
 * `platform` for business logic.
 */

import {
  createEmptyRuntimeCapabilities,
  type RuntimeCapabilities,
  type RuntimePlatform,
} from '../../application/runtime/runtimeCapabilities';

/**
 * Resolve the browser/OS from `navigator.userAgent`. Pure and
 * deterministic so tests can pin it.
 */
export function detectWebPlatform(
  userAgent: string,
  platformHint: string,
): RuntimePlatform {
  const ua = userAgent.toLowerCase();
  const hint = platformHint.toLowerCase();
  if (!ua && !hint) return 'browser';
  if (/iphone|ipad|ipod/.test(ua) || hint === 'iphone' || hint === 'ipad') {
    return 'ios';
  }
  if (/android/.test(ua) || hint === 'android') {
    return 'android';
  }
  if (/mac os|macintosh/.test(ua) || hint.startsWith('mac')) {
    return 'macos';
  }
  if (/windows/.test(ua) || hint.startsWith('win')) {
    return 'windows';
  }
  if (/linux|x11/.test(ua) || hint.includes('linux')) {
    return 'linux';
  }
  return 'unknown';
}

/**
 * Build the Web `RuntimeCapabilities` snapshot. All OS-bridge
 * capabilities are false in WP-09A.
 */
export function createWebRuntimeCapabilities(): RuntimeCapabilities {
  let platform: RuntimePlatform = 'unknown';
  let hostVersion = '';
  if (typeof navigator !== 'undefined') {
    platform = detectWebPlatform(
      typeof navigator.userAgent === 'string' ? navigator.userAgent : '',
      typeof navigator.platform === 'string' ? navigator.platform : '',
    );
    hostVersion =
      typeof navigator.appVersion === 'string' ? navigator.appVersion : '';
  }
  return Object.freeze({
    ...createEmptyRuntimeCapabilities('web', platform),
    hostVersion,
  });
}