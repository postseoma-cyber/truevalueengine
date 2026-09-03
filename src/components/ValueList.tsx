import Link from 'next/link';
import { num, pct, signedPct, kickoff } from '@/lib/fmt';
import { bookName, Empty } from './Modules';
import { Price } from './Price';

type Row = {
  event_id: string; market: string; selection: string;
  model_prob: string | null; market_prob: string | null; best_price: string | null;
  best_book: string | null; book_count: number | null; edge: string | null;
  commence_time: string; home_team: string; away_team: string; competition_id: number;
  href: string | null;
};

const LABEL: Record<string, string> = { home: 'Home', draw: 'Draw', away: 'Away', over: 'Over 2.5', under: 'Under 2.5' };

export function ValueList({ rows }: { rows: Row[] }) {
  if (!rows.length) {
    return (
      <Empty
        head="Nothing to publish in this window"
        body="Either no fixture is priced yet, or the model found no selection it is willing to stand behind. We show an empty list rather than filling it."
      />
    );
  }
  return (
    <div className="scroller">
      <table className="data">
        <thead>
          <tr>
            <th>Kick-off</th>
            <th className="wrap">Fixture</th>
            <th>Selection</th>
            <th className="right">Model</th>
            <th className="right">Market</th>
            <th className="right">Best price</th>
            <th className="wrap">Book</th>
            <th className="right">Edge</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = r.href;
            const label =
              r.selection === 'home' ? r.home_team : r.selection === 'away' ? r.away_team : LABEL[r.selection] ?? r.selection;
            const edge = num(r.edge);
            return (
              <tr key={`${r.event_id}-${r.market}-${r.selection}`}>
                <td className="m" style={{ color: 'var(--muted)' }}>{kickoff(r.commence_time)}</td>
                <td className="wrap">
                  {href ? <Link href={href}>{r.home_team} v {r.away_team}</Link> : `${r.home_team} v ${r.away_team}`}
                </td>
                <td>{label}</td>
                <td className="right m">{pct(num(r.model_prob))}</td>
                <td className="right m">{pct(num(r.market_prob))}</td>
                <td className="right"><Price value={num(r.best_price)} /></td>
                <td className="wrap">{r.best_book ? bookName(r.best_book) : '—'}</td>
                <td className="right">
                  <span className={`m tag${edge && edge > 0 ? ' tag--good' : ''}`}>{signedPct(edge)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
