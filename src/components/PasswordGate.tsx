// PasswordGate.tsx — Blocks access to the demo deployment unless the correct
// password is entered. Only active when VITE_ACCESS_PASSWORD is set (i.e. on
// the Vercel demo). In local dev (no env var) the gate is transparent.

import { useState, useEffect } from 'react';

const STORED_KEY = 'meow-ops-gate';
const PASSWORD   = (import.meta as Record<string, unknown> & { env: Record<string, string> }).env.VITE_ACCESS_PASSWORD as string | undefined;

interface Props { children: React.ReactNode }

export function PasswordGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput]       = useState('');
  const [error, setError]       = useState(false);
  const [shake, setShake]       = useState(false);

  useEffect(() => {
    // No password configured → always open (local dev)
    if (!PASSWORD) { setUnlocked(true); return; }
    // Already unlocked this session
    if (sessionStorage.getItem(STORED_KEY) === PASSWORD) setUnlocked(true);
  }, []);

  function attempt() {
    if (!PASSWORD) return;
    if (input === PASSWORD) {
      sessionStorage.setItem(STORED_KEY, PASSWORD);
      setUnlocked(true);
    } else {
      setError(true);
      setShake(true);
      setInput('');
      setTimeout(() => setShake(false), 500);
    }
  }

  if (unlocked) return <>{children}</>;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a',
      fontFamily: 'JetBrains Mono, monospace',
    }}>
      <div style={{
        width: 340,
        border: '1px solid #1a1a1a',
        background: '#111',
        padding: '32px 28px',
        animation: shake ? 'shake 0.45s ease' : 'none',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <span style={{ fontSize: 22 }}>🐾</span>
          <span style={{ fontSize: 13, color: '#f5f5f5', fontWeight: 600, letterSpacing: 1 }}>
            MEOW OPS
          </span>
        </div>

        <p style={{ fontSize: 11, color: '#666', marginBottom: 20, letterSpacing: 0.5 }}>
          DEMO ACCESS
        </p>

        <input
          type="password"
          value={input}
          autoFocus
          placeholder="enter password"
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          onKeyDown={(e) => e.key === 'Enter' && attempt()}
          style={{
            width: '100%',
            background: '#0a0a0a',
            border: `1px solid ${error ? '#f87171' : '#1a1a1a'}`,
            color: '#f5f5f5',
            padding: '10px 12px',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
            marginBottom: 12,
            boxSizing: 'border-box',
            transition: 'border-color 0.2s',
          }}
        />

        {error && (
          <p style={{ fontSize: 11, color: '#f87171', marginBottom: 10 }}>
            incorrect password
          </p>
        )}

        <button
          onClick={attempt}
          style={{
            width: '100%',
            background: '#49c5b6',
            color: '#0a0a0a',
            border: 'none',
            padding: '10px 0',
            fontSize: 11,
            fontFamily: 'inherit',
            fontWeight: 600,
            letterSpacing: 1,
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          Enter
        </button>

        <p style={{ fontSize: 10, color: '#333', marginTop: 20, textAlign: 'center' }}>
          powered by Meow Creative Haus
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-8px); }
          40%      { transform: translateX(8px); }
          60%      { transform: translateX(-5px); }
          80%      { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}
