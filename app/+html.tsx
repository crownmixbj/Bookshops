import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * The HTML shell every web page is rendered into.
 *
 * Web only — Expo Router ignores this file on iOS and Android, which is
 * exactly what makes it the right place for a CSS font stack. The stack
 * is a list, and only a browser can walk a list; see `fontStack` in
 * theme.js for why the native builds are left on their system face.
 *
 * Setting the family here as well as in the type tokens is deliberate
 * belt-and-braces. The tokens cover text that reads a token; this covers
 * everything else — a Text with a one-off local style, a third-party
 * component, a native input's placeholder — so nothing is left rendering
 * in Times New Roman because it was missed by the audit.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/*
          Inter, self-hosted by Google Fonts' CDN. preconnect first
          because the font file lives on a second origin (gstatic), and
          the browser cannot start that handshake until it has parsed the
          CSS that references it — the two hints save roughly a round
          trip on a cold load.

          display=swap, not the default: a blocked webfont must never
          hold the page blank. Text paints immediately in the next face
          on the stack and re-renders when Inter lands. On a Nigerian
          mobile connection that is the difference between a slow page
          and an empty one.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
        />

        {/*
          Required by Expo Router on web: react-native-web scroll views
          rely on body not scrolling. Must stay above our own styles.
        */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const GLOBAL_CSS = `
:root {
  --loci-font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

html, body, #root {
  font-family: var(--loci-font);
  /* Inter's default figures are proportional, which makes a column of
     prices jitter as the digits change. tnum locks them to one width so
     ₦15,100 and ₦26,300 line up. */
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

/* react-native-web renders Text as <div> and inputs as real form
   elements; form elements do NOT inherit font-family from their parent,
   so without this the search box and every TextInput would fall back to
   the browser default while the text beside them used Inter. */
input, textarea, select, button {
  font-family: var(--loci-font);
}
`;
