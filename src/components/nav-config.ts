import {
  Inbox, ClipboardCheck, Wallet, Swords, GraduationCap, Gauge,
  type LucideIcon,
} from 'lucide-react';

// Navigation — three work surfaces, two rooms, timer is chrome.
//
// Today / Review / Ledger are the job. Sanctum and Learn are the two rooms
// the owner kept. Companion is gone. The focus timer is a chip, not a page.
//
// Product Law 3: a new feature joins Today, Review, or Ledger. It does not
// add a sixth sidebar item.

export interface NavTab {
  id: string;
  label: string;
  /** Question this tab answers. Shown as the page description. */
  description: string;
  /** Zero-padding, full-viewport surface — the 3D scene and the loop canvas. */
  fullBleed?: boolean;
  /** Global date filter is meaningful here. */
  usesDateFilter?: boolean;
  /** Needs `node sync/local-api.mjs`; the shell renders one banner if it is off. */
  needsHelper?: boolean;
  /** Extra strings the command palette should match on. */
  keywords?: readonly string[];
}

export interface NavSurface {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Second key of the `g`-prefixed jump, e.g. `g t` for Today. */
  shortcut: string;
  usesDateFilter?: boolean;
  needsHelper?: boolean;
  fullBleed?: boolean;
  tabs?: readonly NavTab[];
  keywords?: readonly string[];
  /** Reachable from hash and palette, not the sidebar. */
  hidden?: boolean;
}

export const NAV: readonly NavSurface[] = [
  {
    id: 'today',
    label: 'Today',
    icon: Inbox,
    description: 'What your agents did in this range.',
    shortcut: 't',
    usesDateFilter: true,
    keywords: ['home', 'overview', 'inbox', 'granola', 'summary'],
    tabs: [
      {
        id: 'summary',
        label: 'Summary',
        description: 'Sessions, tokens, cost, and where the work went.',
        usesDateFilter: true,
        keywords: ['overview', 'home', 'dashboard'],
      },
      {
        id: 'sessions',
        label: 'Sessions',
        description: 'Every session, newest first. Filter by project, source or model.',
        usesDateFilter: true,
        keywords: ['table', 'list', 'history', 'archive'],
      },
      {
        id: 'runs',
        label: 'Runs',
        description: 'Wall-clock view of parent and subagent runs.',
        keywords: ['agent ops', 'gantt', 'timeline', 'parallel'],
      },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    icon: ClipboardCheck,
    description: 'Proposed changes. Nothing applies until you say so.',
    shortcut: 'r',
    needsHelper: true,
    keywords: ['loops', 'proposals', 'inbox', 'linear'],
    tabs: [
      {
        id: 'inbox',
        label: 'Inbox',
        description: 'Pending proposals, newest first.',
        needsHelper: true,
        keywords: ['review deck', 'proposals', 'ship next', 'digest'],
      },
      {
        id: 'projects',
        label: 'Projects',
        description: 'What each project is for, and the evidence behind it.',
        needsHelper: true,
        keywords: ['project control', 'constitution', 'eagle', 'surgical'],
      },
      {
        id: 'map',
        label: 'Map',
        description: 'How loops connect. Same inbox, graph view.',
        fullBleed: true,
        keywords: ['loom', 'canvas', 'graph', 'the loom'],
      },
    ],
  },
  {
    id: 'ledger',
    label: 'Ledger',
    icon: Wallet,
    description: 'Spend, tokens, and unattributed provider usage.',
    shortcut: 'l',
    usesDateFilter: true,
    keywords: ['usage', 'cost', 'analytics', 'burn', 'money'],
  },
  {
    id: 'sanctum',
    label: 'Sanctum',
    icon: Swords,
    description: 'The same runs as a 3D scene.',
    shortcut: 's',
    fullBleed: true,
    keywords: ['scrying', 'cinematic', '3d', 'dalaran', 'webgl', 'scrying sanctum'],
  },
  {
    id: 'learn',
    label: 'Learn',
    icon: GraduationCap,
    description: 'Concepts you already practiced, mined from your sessions.',
    shortcut: 'n',
    usesDateFilter: true,
    keywords: ['practice', 'learning quest', 'concepts'],
  },
] as const;

/** Reachable, not in the sidebar. Old Superadmin page. */
export const HIDDEN: readonly NavSurface[] = [
  {
    id: 'capacity',
    label: 'Seats',
    icon: Gauge,
    description: 'SaaS seats and CI minutes.',
    shortcut: 'c',
    hidden: true,
    keywords: ['capacity', 'superadmin', 'github actions', 'subscriptions'],
  },
];

const ALL_SURFACES: readonly NavSurface[] = [...NAV, ...HIDDEN];

/** Old hash ids, kept so bookmarks and the PWA shortcut list keep working. */
export const LEGACY_ROUTES: Readonly<Record<string, string>> = {
  overview: 'today/summary',
  home: 'today/summary',
  sessions: 'today/sessions',
  'agent-ops': 'today/runs',
  'loop-review': 'review/inbox',
  'project-control': 'review/projects',
  'loop-ops': 'review/map',
  cost: 'ledger',
  analytics: 'ledger',
  'by-project': 'ledger',
  'by-day': 'ledger',
  'by-action': 'ledger',
  'capacity-usage': 'capacity',
  usage: 'ledger',
  'usage/sessions': 'today/sessions',
  'usage/projects': 'ledger',
  'usage/days': 'ledger',
  'usage/cost': 'ledger',
  'usage/throughput': 'ledger',
  'usage/subscriptions': 'capacity',
  'usage/tools': 'ledger',
  loops: 'review/inbox',
  'loops/review': 'review/inbox',
  'loops/map': 'review/map',
  'loops/projects': 'review/projects',
  agents: 'today/runs',
  'agents/timeline': 'today/runs',
  'agents/cinematic': 'sanctum',
  sanctum: 'sanctum',
  pomodoro: 'today/summary',
  companion: 'today/summary',
  'learning-quest': 'learn',
  'focus/timer': 'today/summary',
  'focus/companion': 'today/summary',
  'focus/practice': 'learn',
};

export const DEFAULT_SURFACE = 'today';

export function surfaceById(id: string): NavSurface | null {
  return ALL_SURFACES.find((surface) => surface.id === id) ?? null;
}

export function defaultTabFor(surfaceId: string): string | null {
  return surfaceById(surfaceId)?.tabs?.[0]?.id ?? null;
}

export function tabById(surfaceId: string, tabId: string): NavTab | null {
  return surfaceById(surfaceId)?.tabs?.find((tab) => tab.id === tabId) ?? null;
}

/**
 * Chrome flags for the active location. A tab's own flag wins over the
 * surface's, so `sanctum/scene` can be full-bleed while Learn is not.
 */
export function resolveChrome(surfaceId: string, tabId: string | null) {
  const surface = surfaceById(surfaceId);
  const tab = tabId ? tabById(surfaceId, tabId) : null;
  return {
    surface,
    tab,
    title: surface?.label ?? 'Meow Ops',
    description: tab?.description ?? surface?.description ?? '',
    fullBleed: tab?.fullBleed ?? surface?.fullBleed ?? false,
    usesDateFilter: tab?.usesDateFilter ?? (surface?.tabs ? false : (surface?.usesDateFilter ?? false)),
    needsHelper: tab?.needsHelper ?? (surface?.tabs ? false : (surface?.needsHelper ?? false)),
  };
}

/** Flat list of every reachable location, for the command palette. */
export interface NavLocation {
  surfaceId: string;
  tabId: string | null;
  label: string;
  group: string;
  description: string;
  icon: LucideIcon;
  keywords: readonly string[];
  path: string;
}

function locationsFor(surface: NavSurface, group: string): NavLocation[] {
  if (!surface.tabs) {
    return [{
      surfaceId: surface.id,
      tabId: null,
      label: surface.label,
      group,
      description: surface.description,
      icon: surface.icon,
      keywords: surface.keywords ?? [],
      path: surface.id,
    }];
  }
  return surface.tabs.map((tab) => ({
    surfaceId: surface.id,
    tabId: tab.id,
    label: `${surface.label} · ${tab.label}`,
    group,
    description: tab.description,
    icon: surface.icon,
    keywords: [...(surface.keywords ?? []), ...(tab.keywords ?? [])],
    path: `${surface.id}/${tab.id}`,
  }));
}

export const NAV_LOCATIONS: readonly NavLocation[] = [
  ...NAV.flatMap((surface) => locationsFor(surface, 'Go to')),
  ...HIDDEN.flatMap((surface) => locationsFor(surface, 'More')),
];
