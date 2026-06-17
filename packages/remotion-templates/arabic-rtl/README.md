# Arabic RTL Template Rules

Use this folder for the first RAIZ-owned Arabic RTL Remotion templates.

Required text baseline:

```css
.arabicText {
  direction: rtl;
  unicode-bidi: plaintext;
  text-align: right;
  font-family: "Cairo", "IBM Plex Sans Arabic", "Noto Sans Arabic", sans-serif;
  line-height: 1.25;
  white-space: pre-wrap;
}
```

Rules:

- Use `direction: rtl`.
- Use `unicode-bidi: plaintext`.
- Do not use letter-spacing for Arabic.
- Prefer Cairo or IBM Plex Sans Arabic.
- Avoid `text-transform: uppercase`.
- Avoid `word-break: break-all`.

Caption rendering should prefer ASS/libass burn-in in the final video pass rather than FFmpeg `drawtext`.
