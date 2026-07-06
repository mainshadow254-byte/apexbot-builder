import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { initApexScanner } from '@/external/apex-scanner/apex-data-bridge';
import {
    digitStats,
    evenOdd,
    gaps,
    honestVerdict,
    lastDigitOf,
    overUnder,
    resolveDecimals,
    riseFall,
} from '@/external/apex-scanner/digit-analysis';
import './analysis-page.scss';

const MAX_TICKS = 1000;

type TSym = { symbol: string; display_name: string; market?: string };

const AnalysisPage: React.FC = () => {
    const [symbols, setSymbols] = useState<TSym[]>([]);
    const [symbol, setSymbol] = useState<string>('R_10');
    const [ready, setReady] = useState(false);
    const [mode, setMode] = useState<'even_odd' | 'over_under'>('even_odd');
    const [barrier, setBarrier] = useState(5);
    const [, setVersion] = useState(0);

    const pricesRef = useRef<number[]>([]);
    const digitsRef = useRef<number[]>([]);
    const decimalsRef = useRef<number>(2);
    const currentPriceRef = useRef<string>('-');
    const subRef = useRef<{ unsubscribe: () => void } | null>(null);
    const activeSymRef = useRef<string>(symbol);

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

    useEffect(() => {
        let cancelled = false;
        activeSymRef.current = symbol;
        setReady(false);
        pricesRef.current = [];
        digitsRef.current = [];
        currentPriceRef.current = '-';

        const recompute = () => {
            const dec = decimalsRef.current;
            digitsRef.current = pricesRef.current.map(p => lastDigitOf(p, dec));
        };

        const cleanup = () => {
            if (subRef.current) {
                try {
                    subRef.current.unsubscribe();
                } catch (e) {
                    /* ignore */
                }
                subRef.current = null;
            }
            (api_base as any)?.api?.send?.({ forget_all: 'ticks' }).catch(() => {});
        };

        (async () => {
            try {
                await initApexScanner();
                if (cancelled) return;

                let pip: any = null;
                try {
                    const ps = (api_base as any)?.pip_sizes;
                    pip = ps && (ps[symbol] ?? (ps.get ? ps.get(symbol) : null));
                } catch (e) {
                    /* ignore */
                }

                const hist = await (api_base as any).api.send({
                    ticks_history: symbol,
                    end: 'latest',
                    count: MAX_TICKS,
                    style: 'ticks',
                });
                if (cancelled || activeSymRef.current !== symbol) return;

                const rawPrices: any[] = hist?.history?.prices || [];
                const sampleStr = rawPrices.length ? String(rawPrices[rawPrices.length - 1]) : undefined;
                decimalsRef.current = resolveDecimals(pip, sampleStr);
                pricesRef.current = rawPrices.map(Number);
                if (pricesRef.current.length) {
                    currentPriceRef.current = Number(pricesRef.current[pricesRef.current.length - 1]).toFixed(
                        decimalsRef.current
                    );
                }
                recompute();
                setReady(true);
                setVersion(v => v + 1);

                await (api_base as any).api.send({ ticks: symbol, subscribe: 1 });
                if (cancelled || activeSymRef.current !== symbol) {
                    cleanup();
                    return;
                }
                const stream = (api_base as any).api.onMessage && (api_base as any).api.onMessage();
                if (stream && stream.subscribe) {
                    subRef.current = stream.subscribe(({ data }: any) => {
                        if (
                            data &&
                            data.msg_type === 'tick' &&
                            data.tick &&
                            data.tick.symbol === activeSymRef.current
                        ) {
                            const q = Number(data.tick.quote);
                            pricesRef.current.push(q);
                            if (pricesRef.current.length > MAX_TICKS) pricesRef.current.shift();
                            currentPriceRef.current = q.toFixed(decimalsRef.current);
                            digitsRef.current.push(lastDigitOf(q, decimalsRef.current));
                            if (digitsRef.current.length > MAX_TICKS) digitsRef.current.shift();
                            setVersion(v => v + 1);
                        }
                    });
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('[ApexAnalysis] subscribe failed:', e);
            }
        })();

        return () => {
            cancelled = true;
            cleanup();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol]);

    const digits = digitsRef.current;
    const prices = pricesRef.current;
    const latestDigit = digits.length ? digits[digits.length - 1] : null;

    const stats = useMemo(() => digitStats(digits), [digits.length, latestDigit]);
    const eo = useMemo(() => evenOdd(digits), [digits.length, latestDigit]);
    const ou = useMemo(() => overUnder(digits, barrier), [digits.length, latestDigit, barrier]);
    const rf = useMemo(() => riseFall(prices), [prices.length, prices[prices.length - 1]]);
    const gp = useMemo(() => gaps(digits), [digits.length, latestDigit]);
    const verdict = useMemo(() => honestVerdict(digits, prices), [digits.length, latestDigit]);

    const ringClass = (d: number) => {
        if (stats.highest && d === stats.highest.digit) return 'apex-analysis__circle--green';
        if (stats.secondHighest && d === stats.secondHighest.digit) return 'apex-analysis__circle--blue';
        if (stats.lowest && d === stats.lowest.digit) return 'apex-analysis__circle--red';
        if (stats.secondLowest && d === stats.secondLowest.digit) return 'apex-analysis__circle--gold';
        return '';
    };

    const last50 = digits.slice(-50);
    const streamDigits = digits.slice(-60).reverse();

    return (
        <div className='apex-analysis'>
            <div className='apex-analysis__topbar'>
                <div className='apex-analysis__price'>
                    {currentPriceRef.current}
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
                            {Array.from({ length: 10 }, (_, d) => (
                                <div key={d} className={`apex-analysis__circle ${ringClass(d)}`}>
                                    <span className='d'>{d}</span>
                                    <span className='p'>{stats.pct[d].toFixed(2)}%</span>
                                    {latestDigit === d && <span className='arrow'>▲</span>}
                                </div>
                            ))}
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
                                <span className='v'>{decimalsRef.current}</span>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AnalysisPage;
