import React, { useEffect, useMemo, useState } from 'react';
import { initApexScanner } from '@/external/apex-scanner/apex-data-bridge';
import { digitStats, evenOdd, gaps, honestVerdict, overUnder, riseFall } from '@/external/apex-scanner/digit-analysis';
import ManualTrade from './manual-trade';
import { useDigitTicks } from './useDigitTicks';
import './analysis-page.scss';

type TSym = { symbol: string; display_name: string; market?: string };

const AnalysisPage: React.FC = () => {
    const [symbols, setSymbols] = useState<TSym[]>([]);
    const [symbol, setSymbol] = useState<string>('R_10');
    const { conn, version, ticks, decimals } = useDigitTicks(symbol);
    const prices = ticks.map(t => t.quote);
    const digits = prices.map(p => {
        const fixed = Number(p).toFixed(decimals);
        return +fixed[fixed.length - 1];
    });
    const ready = ticks.length > 0;
    const currentPrice = prices.length ? Number(prices[prices.length - 1]).toFixed(decimals) : '-';
    const [mode, setMode] = useState<'even_odd' | 'over_under'>('even_odd');
    const [barrier, setBarrier] = useState(5);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await initApexScanner();
            if (cancelled) return;
            const list: TSym[] = ((window as any).symbolsList || []).filter(
                (s: any) => s.market === 'synthetic_index'
            );
            const full: TSym[] = list.length ? list : (window as any).symbolsList || [];
            setSymbols(full);
            if (full.length && !full.find(s => s.symbol === symbol)) {
                setSymbol(full[0].symbol);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const latestDigit = digits.length ? digits[digits.length - 1] : null;

    const stats = useMemo(() => digitStats(digits), [version]);
    const eo = useMemo(() => evenOdd(digits), [version]);
    const ou = useMemo(() => overUnder(digits, barrier), [version, barrier]);
    const rf = useMemo(() => riseFall(prices), [version]);
    const gp = useMemo(() => gaps(digits), [version]);
    const verdict = useMemo(() => honestVerdict(digits, prices), [version]);

    const ringColor = (d: number) => {
        if (stats.highest && d === stats.highest.digit) return '#2fe38b';
        if (stats.secondHighest && d === stats.secondHighest.digit) return '#3d8bff';
        if (stats.lowest && d === stats.lowest.digit) return '#ff5d73';
        if (stats.secondLowest && d === stats.secondLowest.digit) return '#ffb547';
        return '#5a6376';
    };

    const last50 = digits.slice(-50);
    const streamDigits = digits.slice(-60).reverse();

    return (
        <div className='apex-analysis'>
            <div className='apex-analysis__topbar'>
                <div className='apex-analysis__price'>
                    {currentPrice}
                    <small>CURRENT PRICE</small>
                </div>
                <div className='apex-analysis__market'>
                    <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                        {symbols.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                                {s.display_name}
                            </option>
                        ))}
                    </select>
                    <span className={`apex-analysis__conn apex-analysis__conn--${conn}`}>
                        {conn === 'live'
                            ? '● LIVE'
                            : conn === 'connecting'
                              ? '○ CONNECTING'
                              : conn === 'reconnecting'
                                ? '◌ RECONNECTING'
                                : conn === 'stale'
                                  ? '● STALE'
                                  : '● DISCONNECTED'}
                    </span>
                    <span>MARKET</span>
                </div>
            </div>

            {!ready ? (
                <div className='apex-analysis__loading'>Loading live ticks...</div>
            ) : (
                <>
                    <div className='apex-analysis__card'>
                        <h3>Digit Distribution</h3>
                        <div className='apex-analysis__circles'>
                            {Array.from({ length: 10 }, (_, d) => {
                                const C = 2 * Math.PI * 34;
                                const maxPct = stats.highest?.pct || 1;
                                const frac = Math.max(0.03, Math.min(1, stats.pct[d] / maxPct));
                                const color = ringColor(d);
                                return (
                                    <div key={d} className='apex-analysis__circle'>
                                        <svg viewBox='0 0 80 80' className='apex-analysis__ring'>
                                            <circle cx='40' cy='40' r='34' className='apex-analysis__ring-track' />
                                            <circle
                                                cx='40'
                                                cy='40'
                                                r='34'
                                                className='apex-analysis__ring-fill'
                                                stroke={color}
                                                strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`}
                                                transform='rotate(-90 40 40)'
                                            />
                                        </svg>
                                        <div className='apex-analysis__circle-inner'>
                                            <span className='d'>{d}</span>
                                            <span className='p'>{stats.pct[d].toFixed(2)}%</span>
                                        </div>
                                        {latestDigit === d && (
                                            <span className='arrow' style={{ color }}>
                                                ▲
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div className='apex-analysis__rank'>
                            <div>
                                <div className='k'>HIGHEST</div>
                                <div className='v' style={{ color: '#2fe38b' }}>
                                    {stats.highest?.pct.toFixed(2)}%
                                </div>
                            </div>
                            <div>
                                <div className='k'>2ND</div>
                                <div className='v' style={{ color: '#3d8bff' }}>
                                    {stats.secondHighest?.pct.toFixed(2)}%
                                </div>
                            </div>
                            <div>
                                <div className='k'>LOWEST</div>
                                <div className='v' style={{ color: '#ff5d73' }}>
                                    {stats.lowest?.pct.toFixed(2)}%
                                </div>
                            </div>
                            <div>
                                <div className='k'>2ND LOW</div>
                                <div className='v' style={{ color: '#ffb547' }}>
                                    {stats.secondLowest?.pct.toFixed(2)}%
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className='apex-analysis__card'>
                        <h3>Pattern Analysis</h3>
                        <div className='apex-analysis__toggle'>
                            <button
                                className={mode === 'even_odd' ? 'active' : ''}
                                onClick={() => setMode('even_odd')}
                            >
                                EVEN/ODD
                            </button>
                            <button
                                className={mode === 'over_under' ? 'active' : ''}
                                onClick={() => setMode('over_under')}
                            >
                                OVER/UNDER
                            </button>
                        </div>

                        {mode === 'even_odd' ? (
                            <>
                                <div className='apex-analysis__bars'>
                                    <div className='apex-analysis__bar apex-analysis__bar--even'>
                                        <div className='pct'>{eo.evenPct.toFixed(1)}%</div>
                                        <div className='lbl'>EVEN</div>
                                    </div>
                                    <div className='apex-analysis__bar apex-analysis__bar--odd'>
                                        <div className='pct'>{eo.oddPct.toFixed(1)}%</div>
                                        <div className='lbl'>ODD</div>
                                    </div>
                                </div>
                                <h3 style={{ marginTop: '1.6rem' }}>Last 50 Digits Pattern</h3>
                                <div className='apex-analysis__pattern'>
                                    {last50.map((d, i) => (
                                        <div
                                            key={i}
                                            className={`apex-analysis__chip ${
                                                d % 2 === 0 ? 'apex-analysis__chip--even' : 'apex-analysis__chip--odd'
                                            }`}
                                        >
                                            {d % 2 === 0 ? 'E' : 'O'}
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className='apex-analysis__barrier'>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-less-prominent)' }}>
                                        Barrier:
                                    </span>
                                    {Array.from({ length: 10 }, (_, b) => (
                                        <button
                                            key={b}
                                            className={barrier === b ? 'active' : ''}
                                            onClick={() => setBarrier(b)}
                                        >
                                            {b}
                                        </button>
                                    ))}
                                </div>
                                <div className='apex-analysis__bars'>
                                    <div className='apex-analysis__bar apex-analysis__bar--odd'>
                                        <div className='pct'>{ou.overPct.toFixed(1)}%</div>
                                        <div className='lbl'>OVER {barrier}</div>
                                    </div>
                                    <div className='apex-analysis__bar apex-analysis__bar--even'>
                                        <div className='pct'>{ou.underPct.toFixed(1)}%</div>
                                        <div className='lbl'>UNDER {barrier}</div>
                                    </div>
                                </div>
                                <div
                                    style={{
                                        fontSize: '0.75rem',
                                        color: 'var(--text-less-prominent)',
                                        marginTop: '0.8rem',
                                    }}
                                >
                                    Note: "Over 9" and "Under 0" are not valid contracts.
                                </div>
                            </>
                        )}
                    </div>

                    <div className='apex-analysis__card'>
                        <h3>Market Movement (Price Direction)</h3>
                        <div className='apex-analysis__bars'>
                            <div className='apex-analysis__bar apex-analysis__bar--even'>
                                <div className='pct'>{rf.risePct.toFixed(1)}%</div>
                                <div className='lbl'>RISE</div>
                            </div>
                            <div className='apex-analysis__bar apex-analysis__bar--odd'>
                                <div className='pct'>{rf.fallPct.toFixed(1)}%</div>
                                <div className='lbl'>FALL</div>
                            </div>
                        </div>
                    </div>

                    <div className='apex-analysis__card'>
                        <h3>Last Digits Stream</h3>
                        <div className='apex-analysis__stream'>
                            {streamDigits.map((d, i) => (
                                <div
                                    key={i}
                                    className={`apex-analysis__chip ${
                                        mode === 'even_odd'
                                            ? d % 2 === 0
                                                ? 'apex-analysis__chip--even'
                                                : 'apex-analysis__chip--odd'
                                            : d > barrier
                                              ? 'apex-analysis__chip--over'
                                              : 'apex-analysis__chip--under'
                                    }`}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>
                    </div>

                    {verdict && (
                        <div className='apex-analysis__card apex-analysis__ai'>
                            <h3>AI Observations</h3>
                            <ul>
                                {verdict.notes.map((n: string, i: number) => (
                                    <li key={i}>{n}</li>
                                ))}
                                <li>
                                    Hot digit: <b>{verdict.hotDigit}</b> - Cold digit: <b>{verdict.coldDigit}</b>{' '}
                                    (observed frequency in sample).
                                </li>
                            </ul>
                            <div className='disclaimer'>{verdict.disclaimer}</div>
                        </div>
                    )}

                    <div className='apex-analysis__card'>
                        <h3>Gap Analysis</h3>
                        <div className='apex-analysis__stats'>
                            {gp.map(item => (
                                <div className='apex-analysis__stat' key={item.digit}>
                                    <span>Digit {item.digit}</span>
                                    <span className='v'>{item.gap < 0 ? '-' : item.gap}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className='apex-analysis__card'>
                        <h3>Statistics</h3>
                        <div className='apex-analysis__stats'>
                            <div className='apex-analysis__stat'>
                                <span>Total Ticks</span>
                                <span className='v'>{digits.length}</span>
                            </div>
                            <div className='apex-analysis__stat'>
                                <span>Pip Size (decimals)</span>
                                <span className='v'>{decimals}</span>
                            </div>
                        </div>
                    </div>

                    <ManualTrade symbol={symbol} />
                </>
            )}
        </div>
    );
};

export default AnalysisPage;
