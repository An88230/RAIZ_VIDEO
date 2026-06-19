import { continueRender, delayRender, staticFile } from "remotion";

// Custom family name so it never collides with any system-installed font and
// always resolves to the bundled IBM Plex Sans Arabic files.
export const ARABIC_FONT_FAMILY = "IBM Plex Sans Arabic RAIZ";

let started = false;

/**
 * Loads the bundled Arabic font files into the Remotion render browser. Safe to
 * call repeatedly: it only registers a single delayRender handle on first call.
 */
export function ensureArabicFonts(): void {
  if (started || typeof document === "undefined" || typeof FontFace === "undefined") {
    return;
  }

  started = true;
  const handle = delayRender("Loading Arabic fonts");

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

  Promise.all([regular.load(), bold.load()])
    .then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font));
      continueRender(handle);
    })
    .catch(() => {
      // Never block the render on a font failure; fall back to system Arabic.
      continueRender(handle);
    });
}
