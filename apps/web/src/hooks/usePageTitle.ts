import { useEffect } from 'react';

const BASE_TITLE = 'Psst';

/**
 * Sets the browser tab title. Appends " — Psst" if a page name is provided.
 */
export function usePageTitle(pageTitle?: string) {
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} — ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [pageTitle]);
}
