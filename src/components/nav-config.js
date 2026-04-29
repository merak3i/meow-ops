// Single source of truth for sidebar navigation. Sections are visual + semantic
// groupings the Sidebar renders with an Eyebrow label between them. Per-page
// chrome flags (usesDateFilter, fullBleed) live here too so App.jsx no longer
// needs the long `page !== 'pomodoro' && page !== 'companion' && ...` exclusion
// list — it just looks up the active id and reads the flag.

import {
  LayoutDashboard, List, FolderKanban, CalendarDays, Wrench, DollarSign,
  Cat, Timer, BarChart3, GitBranch, Swords,
} from 'lucide-react';

export const NAV_SECTIONS = [
  {
    label: 'Insights',
    items: [
      { id: 'overview',   label: 'Overview',     icon: LayoutDashboard, usesDateFilter: true  },
      { id: 'sessions',   label: 'Sessions',     icon: List,            usesDateFilter: true  },
      { id: 'by-project', label: 'By Project',   icon: FolderKanban,    usesDateFilter: true  },
      { id: 'by-day',     label: 'By Day',       icon: CalendarDays,    usesDateFilter: true  },
      { id: 'by-action',  label: 'By Action',    icon: Wrench,          usesDateFilter: true  },
      { id: 'cost',       label: 'Cost Tracker', icon: DollarSign,      usesDateFilter: true  },
      { id: 'analytics',  label: 'Analytics',    icon: BarChart3,       usesDateFilter: false },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'agent-ops', label: 'Agent Ops',       icon: GitBranch, usesDateFilter: false                  },
      { id: 'sanctum',   label: 'Scrying Sanctum', icon: Swords,    usesDateFilter: false, fullBleed: true },
    ],
  },
  {
    label: 'Living',
    items: [
      { id: 'companion', label: 'Companion',   icon: Cat,   usesDateFilter: false },
      { id: 'pomodoro',  label: 'Focus Timer', icon: Timer, usesDateFilter: false },
    ],
  },
];

// Flat list — rare uses (default fallback, validation).
export const NAV_FLAT = NAV_SECTIONS.flatMap((s) => s.items);

// Look up a single page descriptor by id; returns null if unknown.
export function pageById(id) {
  return NAV_FLAT.find((p) => p.id === id) ?? null;
}
