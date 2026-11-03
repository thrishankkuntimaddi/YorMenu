import { useId, type ReactNode } from 'react';

/*
 * Small animated pictures for "something is happening" moments:
 * the kitchen cooking, a server bringing the bill, waiting for staff, thank you, …
 * Plain SVG + CSS (see .sc-* in styles.css), so they cost nothing to load.
 */

export type SceneKind = 'cooking' | 'preparing' | 'waiting' | 'serving' | 'bill' | 'bill-ready' | 'thanks';

const HEART = 'M6 11 C2 8 0 6 0 3.5 C0 1.5 1.5 0 3.3 0 C4.5 0 5.4 .7 6 1.6 C6.6 .7 7.5 0 8.7 0 C10.5 0 12 1.5 12 3.5 C12 6 10 8 6 11 Z';

function Picture({ kind }: { kind: SceneKind }) {
  const clip = `sc-slot${useId().replace(/:/g, '')}`;
  switch (kind) {
    case 'cooking':
      return (
        <>
          {[40, 55, 70].map((x, i) => (
            <path key={x} className="sc-steam" style={{ animationDelay: `${i * 0.6}s` }} d={`M${x} 48 q-5 -7 0 -14 q5 -7 0 -14`} fill="none" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
          ))}
          {[['#f59e0b', 44, 0], ['#16a34a', 55, 0.25], ['#dc2626', 66, 0.5]].map(([c, x, d]) => (
            <circle key={x as number} className="sc-toss" style={{ animationDelay: `${d}s` }} cx={x as number} cy="62" r="3.5" fill={c as string} />
          ))}
          <path d="M25 63 Q27 76 55 76 Q83 76 85 63 Z" fill="#1f2937" />
          <ellipse cx="55" cy="63" rx="30" ry="4" fill="#374151" />
          <rect x="84" y="61" width="28" height="5" rx="2.5" fill="#7c2d12" />
          {[38, 55, 72].map((x, i) => (
            <path key={x} className="sc-flame" style={{ animationDelay: `${i * 0.15}s` }} d={`M${x} 86 q-6 -4 -2 -9 q1 3 3 3 q-1 -4 2 -7 q4 5 3 9 q2 0 2 -2 q2 4 -2 6 Z`} fill="#f97316" />
          ))}
          <rect x="20" y="85" width="80" height="6" rx="2" fill="#4b5565" />
        </>
      );
    case 'preparing':
      return (
        <>
          <rect x="12" y="72" width="96" height="12" rx="5" fill="#d6a36a" stroke="#b07a3f" strokeWidth="1.5" />
          {[20, 28, 36].map((x, i) => (
            <ellipse key={x} className="sc-slice" style={{ animationDelay: `${i * 0.7}s` }} cx={x} cy="68" rx="3.5" ry="4.5" fill="#fb923c" stroke="#ea580c" />
          ))}
          <path d="M44 63 L84 65 Q90 68 84 71 L44 73 Z" fill="#fb923c" stroke="#ea580c" />
          <path d="M86 66 l10 -6 M87 68 l11 -2 M86 70 l9 3" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" />
          <g className="sc-chop">
            <path d="M42 70 Q44 54 78 54 L78 64 Z" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="1.5" />
            <rect x="78" y="55" width="22" height="8" rx="3" fill="#44403c" />
          </g>
        </>
      );
    case 'waiting':
      return (
        <>
          <circle cx="60" cy="46" r="30" fill="#fff" stroke="var(--brand)" strokeWidth="4" />
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="60" y1="19" x2="60" y2={i % 3 ? 22 : 25} stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 30} 60 46)`} />
          ))}
          <line className="sc-hand-slow" x1="60" y1="46" x2="60" y2="32" stroke="#1d2330" strokeWidth="4" strokeLinecap="round" />
          <line className="sc-hand" x1="60" y1="46" x2="60" y2="24" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="60" cy="46" r="3" fill="#1d2330" />
          {[48, 60, 72].map((x, i) => <circle key={x} className="sc-dot" style={{ animationDelay: `${i * 0.2}s` }} cx={x} cy="88" r="4" fill="var(--brand)" />)}
        </>
      );
    case 'serving':
    case 'bill':
      return (
        <>
          <line className="sc-floor" x1="0" y1="92" x2="120" y2="92" stroke="#cbd5e1" strokeWidth="3" strokeDasharray="10 8" />
          <g className="sc-walk">
            <rect className="sc-leg-a" x="44" y="60" width="6" height="26" rx="3" fill="#1f2937" />
            <rect className="sc-leg-b" x="51" y="60" width="6" height="26" rx="3" fill="#374151" />
            <rect x="41" y="31" width="19" height="32" rx="6" fill="#1f2937" />
            <path d="M46 31 L50.5 42 L55 31 Z" fill="#fff" />
            <path d="M47 33 l3.5 2 l3.5 -2 v4 l-3.5 -2 l-3.5 2 Z" fill="var(--brand)" />
            <circle cx="50.5" cy="21" r="9" fill="#f2c29b" />
            <path d="M41.5 19 Q42 10 50.5 10 Q59 10 59.5 19 Q55 14 50.5 15 Q46 14 41.5 19 Z" fill="#292524" />
            <circle cx="54" cy="21" r="1.2" fill="#1f2937" />
            <path d="M52 25 q2.5 2 5 0" fill="none" stroke="#1f2937" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M57 38 L76 40" stroke="#1f2937" strokeWidth="5.5" strokeLinecap="round" />
            <circle cx="78" cy="40" r="3.2" fill="#f2c29b" />
            <ellipse cx="86" cy="37" rx="15" ry="2.6" fill="#9ca3af" />
            {kind === 'bill' ? (
              <g className="sc-flutter">
                <path d="M79 35 V19 H93 V35 l-2.3 -2 l-2.3 2 l-2.3 -2 l-2.3 2 l-2.3 -2 Z" fill="#fff" stroke="#cbd5e1" />
                <text x="86" y="27.5" textAnchor="middle" fontSize="8" fontWeight="800" fill="var(--brand)">₹</text>
                <line x1="82" y1="31" x2="90" y2="31" stroke="#cbd5e1" strokeWidth="1.2" />
              </g>
            ) : (
              <>
                {[80, 86, 92].map((x, i) => <path key={x} className="sc-steam" style={{ animationDelay: `${i * 0.5}s` }} d={`M${x} 22 q-2 -4 0 -8`} fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />)}
                <path d="M74 35 A12 10 0 0 1 98 35 Z" fill="#e5e7eb" stroke="#9ca3af" />
                <circle cx="86" cy="24" r="2.2" fill="#9ca3af" />
              </>
            )}
          </g>
        </>
      );
    case 'bill-ready':
      return (
        <>
          <clipPath id={clip}><rect x="0" y="44" width="120" height="56" /></clipPath>
          <g clipPath={`url(#${clip})`}>
            <g className="sc-print">
              <path d="M38 40 H82 V92 l-3.7 -3 l-3.7 3 l-3.7 -3 l-3.7 3 l-3.7 -3 l-3.7 3 l-3.7 -3 l-3.7 3 l-3.7 -3 l-3.7 3 l-3.7 -3 Z" fill="#fff" stroke="#cbd5e1" />
              {[52, 59, 66].map((y) => <line key={y} x1="44" y1={y} x2={y === 59 ? 66 : 76} y2={y} stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />)}
              <line x1="44" y1="76" x2="76" y2="76" stroke="#1d2330" strokeWidth="1" strokeDasharray="2 2" />
              <text x="60" y="86" textAnchor="middle" fontSize="9" fontWeight="800" fill="#1d2330">₹ TOTAL</text>
            </g>
          </g>
          <rect x="24" y="22" width="72" height="24" rx="6" fill="#374151" />
          <rect x="34" y="41" width="52" height="4" rx="2" fill="#111827" />
          <circle className="sc-led" cx="86" cy="30" r="3" fill="#22c55e" />
          <g className="sc-pop">
            <circle cx="96" cy="74" r="11" fill="var(--ok)" />
            <path d="M90.5 74 l4 4 l7 -8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </>
      );
    case 'thanks':
      return (
        <>
          {[[22, 0, '#f43f5e'], [92, 0.9, '#fb7185'], [36, 1.8, '#e11d48'], [80, 2.6, '#f43f5e'], [58, 3.3, '#fda4af']].map(([x, d, c]) => (
            <path key={x as number} className="sc-heart" style={{ animationDelay: `${d}s` }} transform={`translate(${x} 78)`} d={HEART} fill={c as string} />
          ))}
          {[[18, 26], [100, 20], [104, 64], [14, 66]].map(([x, y], i) => (
            <path key={i} className="sc-spark" style={{ animationDelay: `${i * 0.4}s` }} d={`M${x} ${y - 5} L${x + 1.5} ${y - 1.5} L${x + 5} ${y} L${x + 1.5} ${y + 1.5} L${x} ${y + 5} L${x - 1.5} ${y + 1.5} L${x - 5} ${y} L${x - 1.5} ${y - 1.5} Z`} fill="#f59e0b" />
          ))}
          <text className="sc-bow" x="60" y="66" textAnchor="middle" fontSize="44">🙏</text>
        </>
      );
  }
}

/** An animated picture with a short message. `big` stacks it for full-page loading screens. */
export function Scene({ kind, title, text, big, children }: { kind: SceneKind; title?: ReactNode; text?: ReactNode; big?: boolean; children?: ReactNode }) {
  return (
    <div className={`scene${big ? ' big' : ''}`} role="status" aria-live="polite">
      <svg className="scene-art" viewBox="0 0 120 100" aria-hidden="true"><Picture kind={kind} /></svg>
      {(title || text || children) && (
        <div className="scene-text">
          {title && <b>{title}</b>}
          {text && <div className="small">{text}</div>}
          {children}
        </div>
      )}
    </div>
  );
}
