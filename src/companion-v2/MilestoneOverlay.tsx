// MilestoneOverlay.tsx — Full-screen celebration overlay for companion milestones.
// Shown on: growth stage changes, token/cost thresholds, coding streaks.
// Auto-dismisses after 4s; user can also click Continue.

interface MilestoneOverlayProps {
  milestone: { title: string; description: string; emoji: string } | null;
  onDismiss: () => void;
}

export function MilestoneOverlay({ milestone, onDismiss }: MilestoneOverlayProps) {
  if (!milestone) return null;

  return (
    <div
      onClick={onDismiss}
      style={{
        position:        'fixed',
        inset:           0,
        zIndex:          300,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        background:      'rgba(0, 0, 0, 0.45)',
        backdropFilter:  'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation:       'fadeIn 0.3s ease',
      }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
        @keyframes pop { 0% { transform: scale(0.8); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:    'var(--bg-card)',
          border:        '1px solid var(--accent)',
          borderRadius:  16,
          padding:       '36px 40px',
          maxWidth:      360,
          textAlign:     'center',
          boxShadow:     '0 0 48px rgba(var(--accent-rgb, 99,102,241), 0.3)',
          animation:     'pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <div style={{ fontSize: 52, marginBottom: 12, lineHeight: 1 }}>
          {milestone.emoji}
        </div>
        <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-primary)', marginBottom: 8 }}>
          {milestone.title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
          {milestone.description}
        </div>
        <button
          onClick={onDismiss}
          style={{
            padding:      '9px 32px',
            borderRadius: 8,
            border:       '1px solid var(--accent)',
            background:   'transparent',
            color:        'var(--accent)',
            fontSize:     13,
            cursor:       'pointer',
            fontFamily:   'inherit',
            transition:   'all 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
            (e.currentTarget as HTMLButtonElement).style.color = '#000';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
