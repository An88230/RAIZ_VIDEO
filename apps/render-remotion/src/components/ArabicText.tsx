import React from "react";

import { ARABIC_FONT_FAMILY, ensureArabicFonts } from "../fonts";

export interface ArabicTextProps {
  children: React.ReactNode;
  weight?: number;
  style?: React.CSSProperties;
}

/**
 * RTL-first Arabic text. Follows the RAIZ Arabic RTL rules: direction rtl,
 * unicode-bidi plaintext, no letter-spacing, no uppercase, Cairo/IBM Plex.
 */
export const ArabicText: React.FC<ArabicTextProps> = ({ children, weight = 400, style }) => {
  ensureArabicFonts();

  return (
    <div
      dir="rtl"
      style={{
        fontFamily: `'${ARABIC_FONT_FAMILY}', 'Geeza Pro', 'Noto Sans Arabic', sans-serif`,
        direction: "rtl",
        unicodeBidi: "plaintext",
        fontWeight: weight,
        whiteSpace: "pre-wrap",
        margin: 0,
        ...style
      }}
    >
      {children}
    </div>
  );
};
