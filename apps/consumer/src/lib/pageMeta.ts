import { useEffect } from 'react';

/**
 * The page's title and description, for the tab, for sharing and for
 * search engines — set from the page, put back when it unmounts.
 *
 * The app is client-rendered, so this is what a crawler that runs
 * scripts sees; `index.html` carries the site-wide default for one that
 * does not. A page that must not be indexed (the not-found page) says
 * so with a robots tag that leaves with it.
 */
const SITE = 'Velnes';
let defaultDescription: string | null = null;

function meta(name: string): HTMLMetaElement {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  return el;
}

export function usePageMeta({
  title,
  description,
  noindex = false,
}: {
  title: string;
  description: string;
  noindex?: boolean;
}) {
  useEffect(() => {
    const d = meta('description');
    if (defaultDescription == null) defaultDescription = d.getAttribute('content') ?? '';
    document.title = `${title} | ${SITE}`;
    d.setAttribute('content', description);
    const robots = noindex ? meta('robots') : null;
    robots?.setAttribute('content', 'noindex');
    return () => {
      document.title = SITE;
      d.setAttribute('content', defaultDescription ?? '');
      robots?.remove();
    };
  }, [title, description, noindex]);
}
