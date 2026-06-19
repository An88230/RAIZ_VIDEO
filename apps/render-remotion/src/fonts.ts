import { continueRender, delayRender, staticFile } from "remotion";

// Custom family name so it never collides with any system-installed font and
// always resolves to the bundled IBM Plex Sans Arabic files.
export const ARABIC_FONT_FAMILY = "IBM Plex Sans Arabic RAIZ";

let started = false;

/**
 * Loads the bundled Arabic font files into the Remotion render browser.
 *
 * Remotion periodically reloads the rendering tab during long/video renders,
 * which re-evaluates this module and re-runs font loading. To stay robust we
 * cap how long the font load may block a frame: after a short safety window we
 * continue rendering regardless, falling back to the system Arabic font. This
 * prevents "delayRender() was not cleared" timeouts (e.g. with b-roll video).
 */
export function ensureArabicFonts(): void {
  if (started || typeof document === "undefined" || typeof FontFace === "undefined") {
    return;
  }

  started = true;
  const handle = delayRender("Loading Arabic fonts", { timeoutInMilliseconds: 60000 });

  const regular = new FontFace(
    ARABIC_FONT_FAMILY,
    `url(${staticFile("fonts/IBMPlexSansArabic-Regular.ttf")}) format('truetype')`,
    { weight: "400" }
  );
  const bold = new FontFace(
    ARABIC_FONT_FAMILY,
    `url(${staticFile("fonts/IBMPlexSansArabic-Bold.ttf")}) format('truetype')`,
    { weight: "700" }
  );

  const load = Promise.all([regular.load(), bold.load()])
    .then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font));
    })
    .catch(() => {
      // Fall back to the system Arabic font on any failure.
    });

  const safetyWindow = new Promise<void>((resolveSafety) => {
    setTimeout(resolveSafety, 8000);
  });

  Promise.race([load, safetyWindow]).finally(() => continueRender(handle));
}
