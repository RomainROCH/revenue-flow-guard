import type { ReactNode } from 'react';
import { parseSitesPublicConfig } from '../lib/public-runtime';

export default function RootLayout({ children }: { children: ReactNode }) {
  const config = parseSitesPublicConfig(process.env as Record<string, string | undefined>);
  const bodyClass = config.publicationReady
    ? 'case-study state-ready'
    : 'case-study state-publication-inputs-missing';

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Revenue Flow Guard case study" />
        <title>Revenue Flow Guard case study</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body className={bodyClass}>
        {children}
      </body>
    </html>
  );
}
