// usePageRoute — hash-based routing on top of the NAV_SECTIONS config.
//
// Why hash and not History API: this is a static PWA hosted on Vercel with no
// server-side route table. History API routing would 404 on direct deep-links
// to /sanctum unless we add a SPA-rewrite, which the README explicitly rejects
// in favour of "no backend, no SSR". Hash routing works everywhere — local
// dev, vercel.app, file:// — with zero infra. Trade-off: URLs read
// `meow-ops.app/#/sanctum` instead of `meow-ops.app/sanctum`. Acceptable.
//
// API mirrors the previous useState shape, so `const [page, setPage] = ...`
// in App.jsx becomes `const [page, setPage] = usePageRoute()` with no other
// changes downstream.

import { useEffect, useState } from 'react';

import { pageById } from '../components/nav-config';

const DEFAULT_PAGE = 'overview';

function pageFromHash() {
  const raw = (typeof window !== 'undefined' ? window.location.hash : '') || '';
  const id  = raw.replace(/^#\/?/, '');
  return pageById(id) ? id : DEFAULT_PAGE;
}

export function usePageRoute() {
  const [page, setPage] = useState(pageFromHash);

  // Sync hash → state (handles browser back/forward + external hash changes).
  useEffect(() => {
    function onHashChange() {
      setPage(pageFromHash());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Sync state → hash. Calling navigate writes the hash; the hashchange
  // listener echoes back into state. We guard against redundant writes so
  // we don't push duplicate history entries when the user clicks the
  // already-active item.
  function navigate(id) {
    if (!pageById(id)) return;
    const next = '#/' + id;
    if (window.location.hash !== next) {
      window.location.hash = next;
    }
  }

  return [page, navigate];
}
