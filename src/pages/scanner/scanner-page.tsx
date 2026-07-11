import { useEffect, useRef, useState } from 'react';
import { Localize } from '@deriv-com/translations';
import {
    getAutoTraderState,
    onAutoTraderEvent,
    startAutoTrader,
    stopAutoTrader,
} from '@/external/apex-scanner/apex-auto-trader';
import './scanner-page.scss';

const SETTING_KEYS = {
    stake: 'apex_ai_stake',
    takeProfit: 'apex_ai_takeprofit',
    stopLoss: 'apex_ai_stoploss',
    duration: 'apex_ai_duration',
    multiplier: 'apex_ai_multiplier',
    martingale: 'apex_ai_martingale',
    safeMode: 'apex_ai_safemode',
    maxStake: 'apex_ai_maxstake',
    category: 'apex_ai_category',
    tradeType: 'apex_ai_tradetype',
};

type TScanRow = {
    name: string;
    symbol: string;
    direction?: string;
    entry?: string;
    confidence: number;
    edgePct?: number;
    wait?: boolean;
    note?: string;
};

type TToast = {
    id: number;
    win: boolean;
    profit: number;
};

type TResultPopup = {
    kind: string;
    amount: number;
};

const load = (key: string, fallback: string) => {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch (e) {
        return fallback;
    }
};

const loadBool = (key: string, fallback: boolean) => {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value === 'true';
    } catch (e) {
        return fallback;
    }
};

const ScannerPage = () => {
    const [running, setRunning] = useState(getAutoTraderState().running);
    const [stake, setStake] = useState(load(SETTING_KEYS.stake, '1'));
    const [takeProfit, setTakeProfit] = useState(load(SETTING_KEYS.takeProfit, '10'));
    const [stopLoss, setStopLoss] = useState(load(SETTING_KEYS.stopLoss, '30'));
    const [duration, setDuration] = useState(load(SETTING_KEYS.duration, '1'));
    const [multiplier, setMultiplier] = useState(load(SETTING_KEYS.multiplier, '2'));
    const [maxStake, setMaxStake] = useState(load(SETTING_KEYS.maxStake, '0'));
    const [martingale, setMartingale] = useState(loadBool(SETTING_KEYS.martingale, true));
    const [safeMode, setSafeMode] = useState(loadBool(SETTING_KEYS.safeMode, false));
    const [category, setCategory] = useState(load(SETTING_KEYS.category, 'synthetic_index'));
    const [tradeType, setTradeType] = useState(load(SETTING_KEYS.tradeType, 'Rise / Fall'));
    const [stats, setStats] = useState(getAutoTraderState());
    const [scanRows, setScanRows] = useState<TScanRow[]>([]);
    const [digitTable, setDigitTable] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [resultPopup, setResultPopup] = useState<TResultPopup | null>(null);
    const [toasts, setToasts] = useState<TToast[]>([]);
    const toastId = useRef(0);

    useEffect(() => {
        const off = onAutoTraderEvent((evt: any, snap: ReturnType<typeof getAutoTraderState>) => {
            setStats(snap);
            setRunning(snap.running);

            if (evt.type === 'scanning') {
                setStatusMsg(`Scanning ${evt.index}/${evt.total} - ${evt.name}`);
            } else if (evt.type === 'scanTable') {
                setDigitTable(Boolean(evt.digit));
                setScanRows(evt.rows);
            } else if (evt.type === 'noEntry') {
                setStatusMsg(`No entry - best confidence ${evt.bestConfidence}% (needs ${evt.threshold}%). Rescanning...`);
            } else if (evt.type === 'placing') {
                const label = evt.entry.barrier !== undefined ? `${evt.entry.direction} ${evt.entry.barrier}` : evt.entry.direction;
                setStatusMsg(`Placing ${label} on ${evt.entry.name} - stake ${evt.stake}`);
            } else if (evt.type === 'settled') {
                const id = ++toastId.current;
                setToasts(current => [...current, { id, win: evt.isWin, profit: evt.profit }]);
                window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 4000);
            } else if (evt.type === 'tradeError') {
                setStatusMsg(`Warning: ${evt.message}`);
            } else if (evt.type === 'started') {
                setStatusMsg('Smart AI started. Scanning for a clean entry...');
            } else if (evt.type === 'stopped') {
                setStatusMsg('Smart AI stopped.');
                if (evt.stopReason && evt.stopReason.kind && evt.stopReason.kind !== 'manual') {
                    setResultPopup({ kind: evt.stopReason.kind, amount: evt.stopReason.amount });
                }
            }
        });
        return off;
    }, []);

    const persist = () => {
        localStorage.setItem(SETTING_KEYS.stake, stake);
        localStorage.setItem(SETTING_KEYS.takeProfit, takeProfit);
        localStorage.setItem(SETTING_KEYS.stopLoss, stopLoss);
        localStorage.setItem(SETTING_KEYS.duration, duration);
        localStorage.setItem(SETTING_KEYS.multiplier, multiplier);
        localStorage.setItem(SETTING_KEYS.maxStake, maxStake);
        localStorage.setItem(SETTING_KEYS.martingale, String(martingale));
        localStorage.setItem(SETTING_KEYS.safeMode, String(safeMode));
        localStorage.setItem(SETTING_KEYS.category, category);
        localStorage.setItem(SETTING_KEYS.tradeType, tradeType);
    };

    const handleStart = () => {
        persist();
        setResultPopup(null);
        startAutoTrader({
            stake,
            takeProfit,
            stopLoss,
            duration,
            multiplier,
            maxStake,
            martingale,
            safeMode,
            category,
            tradeType,
        });
    };

    return (
        <div className='apex-ai'>
            <div className='apex-ai__header'>
                <h2>
                    <Localize i18n_default_text='Smart AI Auto-Trader' />
                </h2>
                <span className={`apex-ai__pill ${running ? 'on' : ''}`}>{running ? 'RUNNING' : 'IDLE'}</span>
            </div>

            <div className='apex-ai__stats'>
                <div>
                    <span>P/L</span>
                    <b className={stats.totalProfit >= 0 ? 'pos' : 'neg'}>{stats.totalProfit.toFixed(2)}</b>
                </div>
                <div>
                    <span>Won</span>
                    <b>{stats.won}</b>
                </div>
                <div>
                    <span>Lost</span>
                    <b>{stats.lost}</b>
                </div>
                <div>
                    <span>Runs</span>
                    <b>{stats.runs}</b>
                </div>
                <div>
                    <span>Stake</span>
                    <b>{stats.currentStake}</b>
                </div>
            </div>

            <div className='apex-ai__settings'>
                <label>
                    Trade Type
                    <select value={tradeType} disabled={running} onChange={event => setTradeType(event.target.value)}>
                        <option value='Rise / Fall'>Rise / Fall (price direction - real signal)</option>
                        <option value='Over / Under'>Over / Under (digit - edge-ranked odds)</option>
                        <option value='Even / Odd'>Even/Odd (digit - ~50/50, near-random)</option>
                        <option value='Matches / Differs'>Matches/Differs (digit - structural odds)</option>
                    </select>
                </label>
                <label>
                    Market group
                    <select value={category} disabled={running} onChange={event => setCategory(event.target.value)}>
                        <option value='synthetic_index'>Synthetics</option>
                        <option value='forex'>Forex</option>
                        <option value='commodities'>Commodities</option>
                        <option value='cryptocurrency'>Cryptocurrency</option>
                        <option value='indices'>Stock Indices</option>
                    </select>
                </label>
                <label>
                    Stake (USD)
                    <input type='number' value={stake} disabled={running} onChange={event => setStake(event.target.value)} />
                </label>
                <label>
                    Take Profit
                    <input
                        type='number'
                        value={takeProfit}
                        disabled={running}
                        onChange={event => setTakeProfit(event.target.value)}
                    />
                </label>
                <label>
                    Stop Loss
                    <input
                        type='number'
                        value={stopLoss}
                        disabled={running}
                        onChange={event => setStopLoss(event.target.value)}
                    />
                </label>
                <label>
                    Duration (Ticks)
                    <input
                        type='number'
                        value={duration}
                        disabled={running}
                        onChange={event => setDuration(event.target.value)}
                    />
                </label>
                <label>
                    Martingale Multiplier
                    <input
                        type='number'
                        value={multiplier}
                        disabled={running}
                        onChange={event => setMultiplier(event.target.value)}
                    />
                </label>
                <label>
                    Max Stake (0=off)
                    <input
                        type='number'
                        value={maxStake}
                        disabled={running}
                        onChange={event => setMaxStake(event.target.value)}
                    />
                </label>
                <label className='apex-ai__toggle'>
                    <span>Martingale</span>
                    <input
                        type='checkbox'
                        checked={martingale}
                        disabled={running}
                        onChange={event => setMartingale(event.target.checked)}
                    />
                </label>
                <label className='apex-ai__toggle'>
                    <span>Safe Mode</span>
                    <input
                        type='checkbox'
                        checked={safeMode}
                        disabled={running}
                        onChange={event => setSafeMode(event.target.checked)}
                    />
                </label>
            </div>

            {!running ? (
                <button className='apex-ai__start' onClick={handleStart}>
                    Start AI
                </button>
            ) : (
                <button className='apex-ai__stop' onClick={stopAutoTrader}>
                    Stop AI
                </button>
            )}

            <div className='apex-ai__status'>{statusMsg}</div>

            <div className='apex-ai__note'>
                Auto-trading with martingale carries real risk. Stop Loss is a hard circuit breaker.
                <br />
                Rise/Fall uses the live price-direction scanner (real signal). Digit "confidence" is the{' '}
                <b>structural win-probability</b> of the contract; <b>EDGE</b> shows how far recent digits deviate
                from pure random. Digits are RNG - this is honest odds ranked by recent edge, NOT a prediction,
                and higher win-% means smaller payout. Test on Demo first.
            </div>

            <div className='apex-ai__scanner'>
                <div className='apex-ai__scanner-head'>
                    <span>Market Scanner ({scanRows.length})</span>
                    <span>by confidence</span>
                </div>
                <div className={`apex-ai__row apex-ai__row--head ${digitTable ? 'apex-ai__row--digit' : ''}`}>
                    <span>MARKET</span>
                    <span>{digitTable ? 'ENTRY' : 'SIGNAL'}</span>
                    {digitTable && <span>EDGE</span>}
                    <span>CONF</span>
                </div>
                {scanRows.map(row => (
                    <div className={`apex-ai__row ${digitTable ? 'apex-ai__row--digit' : ''}`} key={row.symbol}>
                        <span>{row.name}</span>
                        {digitTable ? (
                            <span className='pos'>{row.entry}</span>
                        ) : (
                            <span className={row.direction === 'RISE' ? 'pos' : 'neg'}>
                                {row.wait ? 'WAIT' : row.direction}
                            </span>
                        )}
                        {digitTable && (
                            <span className={(row.edgePct || 0) > 0 ? 'pos' : (row.edgePct || 0) < 0 ? 'neg' : ''}>
                                {(row.edgePct || 0) > 0 ? '+' : ''}
                                {row.edgePct ?? 0}%
                            </span>
                        )}
                        <span>{row.confidence}%</span>
                    </div>
                ))}
            </div>

            <div className='apex-ai__toasts'>
                {toasts.map(toast => (
                    <div key={toast.id} className={`apex-ai__toast ${toast.win ? 'win' : 'loss'}`}>
                        {toast.win ? 'Win +' : 'Loss '}
                        {toast.profit.toFixed(2)} USD
                    </div>
                ))}
            </div>

            {resultPopup && (
                <div className='apex-ai__popup-overlay' onClick={() => setResultPopup(null)}>
                    <div className='apex-ai__popup' onClick={event => event.stopPropagation()}>
                        <div className='apex-ai__popup-icon'>AI</div>
                        <div className='apex-ai__popup-title'>
                            {resultPopup.kind === 'takeProfit' ? 'Take Profit Hit' : 'Stop Loss Hit'}
                        </div>
                        <div className={`apex-ai__popup-amount ${resultPopup.amount >= 0 ? 'pos' : 'neg'}`}>
                            {resultPopup.amount >= 0 ? '+' : ''}
                            {resultPopup.amount.toFixed(2)} USD
                        </div>
                        <button className='apex-ai__popup-close' onClick={() => setResultPopup(null)}>
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScannerPage;
