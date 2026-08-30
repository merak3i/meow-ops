import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_SURFACE,
  LEGACY_ROUTES,
  defaultTabFor,
  surfaceById,
  tabById,
} from '../components/nav-config';

// Hash routing, now two levels deep: `#/usage/cost`, `#/loops/review?entity=x`.
//
// Still hash rather than History API for the same reason as before: this is a
// static PWA with no server route table, so `/usage/cost` would 404 on a direct
// deep link without a SPA rewrite.
//
// Old single-level ids (`#/sanctum`, `#/by-day`) are rewritten to their new
// home via LEGACY_ROUTES using replaceState, so an old bookmark lands in the
// right place without leaving a dead entry in browser history.

export interface Route {
  surface: string;
  tab: string | null;
  /** Query string after the path, e.g. `entity=foo`. */
  query: URLSearchParams;
}

function parseHash(raw: string): { path: string; query: string } {
  const withoutHash = raw.replace(/^#\/?/, '');
  const [path = '', query = ''] = withoutHash.split('?');
  return { path, query };
}

function resolve(raw: string): { route: Route; canonical: string } {
  const { path, query } = parseHash(raw);
  const params = new URLSearchParams(query);

  const legacy = LEGACY_ROUTES[path];
  const effective = legacy ?? path;
  const [rawSurface = '', rawTab] = effective.split('/');

  const surface = surfaceById(rawSurface) ? rawSurface : DEFAULT_SURFACE;
  const fallbackTab = defaultTabFor(surface);
  const tab = rawTab && tabById(surface, rawTab) ? rawTab : fallbackTab;

  const canonicalPath = tab ? `${surface}/${tab}` : surface;
  const canonical = `#/${canonicalPath}${query ? `?${query}` : ''}`;

  return { route: { surface, tab, query: params }, canonical };
}

export function useRoute() {
  const [raw, setRaw] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash));

  useEffect(() => {
    function onHashChange() {
      setRaw(window.location.hash);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const { route, canonical } = resolve(raw);

  // Normalise legacy, partial and unknown hashes in place. replaceState keeps
  // the back button pointing at wherever the user actually came from.
  // Depend on `raw` as well as `canonical`: two aliases can share a canonical
  // (pomodoro and companion both map to today/summary). If we only watch
  // canonical, a second alias while already on Today never rewrites the URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === canonical) return;
    window.history.replaceState(null, '', canonical);
    if (raw !== canonical) setRaw(canonical);
  }, [canonical, raw]);

  const navigate = useCallback((surface: string, tab?: string | null, query?: string) => {
    if (!surfaceById(surface)) return;
    const resolvedTab = tab && tabById(surface, tab) ? tab : defaultTabFor(surface);
    const path = resolvedTab ? `${surface}/${resolvedTab}` : surface;
    const next = `#/${path}${query ? `?${query}` : ''}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, []);

  /** Switch tab within the current surface, dropping any query params. */
  const setTab = useCallback((tab: string) => {
    navigate(route.surface, tab);
  }, [navigate, route.surface]);

  return { route, navigate, setTab };
}
