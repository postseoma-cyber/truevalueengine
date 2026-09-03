'use client';

import { useEffect, useState } from 'react';
import { formatOdds, type OddsFormat } from '@/lib/fmt';

const KEY = 'tve.oddsFormat';

function read(): OddsFormat {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'fractional' || v === 'american' || v === 'decimal') return v;
  } catch {
    /* private mode, blocked storage — decimal is the documented default */
  }
  return 'decimal';
}

/**
 * Odds render as decimal on the server so the crawler and a no-JS reader see a
 * real number, then convert in place if the reader has chosen another format.
 */
export function Price({ value }: { value: number | null }) {
  const [f, setF] = useState<OddsFormat>('decimal');
  useEffect(() => {
    setF(read());
    const h = (e: Event) => setF(((e as CustomEvent).detail as OddsFormat) ?? read());
    window.addEventListener('tve:oddsformat', h);
    return () => window.removeEventListener('tve:oddsformat', h);
  }, []);
  return <span className="m">{formatOdds(value, f)}</span>;
}

export function OddsFormatSwitcher() {
  const [f, setF] = useState<OddsFormat>('decimal');
  useEffect(() => setF(read()), []);
  const pick = (v: OddsFormat) => {
    setF(v);
    try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('tve:oddsformat', { detail: v }));
  };
  const opts: { v: OddsFormat; label: string }[] = [
    { v: 'decimal', label: 'Decimal' },
    { v: 'fractional', label: 'Fractional' },
    { v: 'american', label: 'American' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Odds format">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => pick(o.v)}
          aria-pressed={f === o.v}
          style={{
            padding: '6px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
            fontFamily: 'inherit',
            border: '1px solid ' + (f === o.v ? 'var(--accent)' : 'var(--rule)'),
            background: f === o.v ? 'var(--accent)' : 'transparent',
            color: f === o.v ? '#12100C' : 'var(--body)',
            fontWeight: f === o.v ? 600 : 500,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
