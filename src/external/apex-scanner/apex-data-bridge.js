// ApexTraders AI Scanner data bridge.
// Feeds the orb + scanner from the template's SINGLE authenticated api_base
// connection (same socket used for login/charts/trading) - no second WebSocket.
// Exposes the window.* globals the ported orb.js expects.

import { api_base } from '@/external/bot-skeleton';
import { analyze, analyzeDigits, analyzeReversion } from './scanner';

const CANDLE_COUNT = 300;
const CANDLE_GRANULARITY = 60;
const HIGHER_TF_GRANULARITY = 300;
const HIGHER_TF_COUNT = 100;

let initialized = false;
let currentTickSymbol = null;
let tickStreamSub = null;

function waitForApi(timeoutMs = 20000) {
    return new Promise(resolve => {
        const start = Date.now();
        const check = () => {
            const conn = api_base && api_base.api && api_base.api.connection;
            if (conn && conn.readyState === WebSocket.OPEN) return resolve(true);
            if (Date.now() - start > timeoutMs) return resolve(false);
            setTimeout(check, 400);
        };
        check();
    });
}

function apiSend(request) {
    if (!api_base || !api_base.api) return Promise.reject(new Error('API not ready'));
    return api_base.api.send(request);
}

async function fetchActiveSymbols() {
    try {
        const cached = api_base && api_base.active_symbols;
        if (cached && cached.length && cached[0] && 'market' in cached[0]) {
            return cached;
        }
    } catch (e) {
        /* fall through to fresh request */
    }
    const resp = await apiSend({ active_symbols: 'brief' });
    return (resp && resp.active_symbols) || [];
}

function mapSymbols(raw) {
    return (raw || []).map(s => ({
        ...s,
        symbol: s.symbol || s.underlying_symbol,
        display_name: s.display_name || s.underlying_symbol_name || s.symbol,
        market: s.market,
        market_display_name: s.market_display_name || s.market || 'Markets',
        submarket_display_name: s.submarket_display_name || s.submarket || '',
        exchange_is_open: typeof s.exchange_is_open === 'number' ? s.exchange_is_open : 1,
    }));
}

async function getCandles(symbol, { granularity = CANDLE_GRANULARITY, count = CANDLE_COUNT } = {}) {
    const resp = await apiSend({
        ticks_history: symbol,
        style: 'candles',
        granularity,
        count,
        end: 'latest',
        adjust_start_time: 1,
    });
    return resp; // resp.candles = [{ epoch, open, high, low, close }]
}

function decimalsFromPip(pip, fallback = 2) {
    if (typeof pip !== 'number' || !Number.isFinite(pip)) return fallback;
    if (pip >= 1) return Math.max(0, Math.round(pip));
    return Math.max(0, Math.round(Math.log10(1 / pip)));
}

function formatDigitQuote(quote, decimals) {
    const n = Number(quote);
    return Number.isFinite(n) ? n.toFixed(decimals) : String(quote);
}

async function ensureDigits(symbol, minTicks = 25, timeoutMs = 6000) {
    if (currentTickSymbol !== symbol || !window._digits || window._digits.length === 0) {
        try {
            await subscribeDigits(symbol);
        } catch (e) {
            /* ignore */
        }
    }

    const start = Date.now();
    while ((window._digits ? window._digits.length : 0) < minTicks) {
        if (Date.now() - start > timeoutMs) break;
        await new Promise(r => setTimeout(r, 200));
    }

    if ((window._digits ? window._digits.length : 0) < minTicks) {
        try {
            const r = await apiSend({
                ticks_history: symbol,
                style: 'ticks',
                count: minTicks,
                end: 'latest',
                adjust_start_time: 1,
            });
            const prices = r && r.history && Array.isArray(r.history.prices) ? r.history.prices : [];
            const decimals = decimalsFromPip(r && r.pip_size, window._digitDecimals || 2);
            if (prices.length) {
                const formatted = prices.map(p => formatDigitQuote(p, decimals));
                window._digits = formatted.concat(window._digits || []).slice(-100);
                window._digitDecimals = decimals;
            }
        } catch (e) {
            /* ignore */
        }
    }
    return window._digits || [];
}

async function apexScan(symbol, tradeType) {
    const r = await getCandles(symbol, { count: CANDLE_COUNT });

    // Guard: no candles = market closed or no data available (forex/commodities
    // close on weekends/off-hours; synthetics are 24/7 and always return data).
    if (!r || !r.candles || r.candles.length === 0) {
        return { noData: true, symbol };
    }

    const DIGIT_TYPES = ['Even / Odd', 'Over / Under', 'Matches / Differs'];
    const isDigit = DIGIT_TYPES.includes(tradeType);
    const digits = isDigit
        ? await ensureDigits(symbol)
        : (symbol === currentTickSymbol ? window._digits || [] : []);

    // Rise/Fall on synthetics -> MEAN-REVERSION engine (tick-based).
    if (tradeType === 'Rise / Fall') {
        const info = (window.symbolsList || []).find(s => s.symbol === symbol || s.underlying_symbol === symbol);
        const isSynthetic = info ? info.market === 'synthetic_index' : /^(R_|1HZ|BOOM|CRASH|stpRNG|JD|RDBEAR|RDBULL)/i.test(symbol);
        if (isSynthetic) {
            let ticks = [];
            try {
                const resp = await apiSend({
                    ticks_history: symbol,
                    style: 'ticks',
                    count: 200,
                    end: 'latest',
                    adjust_start_time: 1,
                });
                ticks = (resp?.history?.prices || []).map(Number);
            } catch (e) {
                /* fall back to candles inside analyzeReversion */
            }
            const rev = analyzeReversion(ticks, r.candles);
            if (rev) return rev;
        }
        // if reversion couldn't compute, fall through to old analyze() as fallback
    }

    let higher = null;
    try {
        const h = await getCandles(symbol, { granularity: HIGHER_TF_GRANULARITY, count: HIGHER_TF_COUNT });
        higher = h.candles;
    } catch (e) {
        /* higher timeframe optional */
    }
    return analyze(r.candles, analyzeDigits(digits), higher);
}

async function subscribeDigits(symbol) {
    if (tickStreamSub && typeof tickStreamSub.unsubscribe === 'function') {
        try {
            tickStreamSub.unsubscribe();
        } catch (e) {
            /* ignore */
        }
        tickStreamSub = null;
    }
    window._digits = [];
    window._digitDecimals = undefined;
    currentTickSymbol = symbol;
    try {
        await apiSend({ ticks: symbol, subscribe: 1 });
    } catch (e) {
        /* ignore */
    }
    try {
        const stream = api_base.api.onMessage && api_base.api.onMessage();
        if (stream && stream.subscribe) {
            tickStreamSub = stream.subscribe(({ data }) => {
                if (data && data.msg_type === 'tick' && data.tick && data.tick.symbol === symbol) {
                    const t = data.tick;
                    const fallbackDecimals = (String(t.quote).split('.')[1] || '').length || window._digitDecimals || 2;
                    const decimals = decimalsFromPip(t.pip_size, fallbackDecimals);
                    const formatted = formatDigitQuote(t.quote, decimals);
                    window._digits = window._digits || [];
                    window._digits.push(formatted);
                    if (window._digits.length > 100) window._digits.shift();
                    window._digitDecimals = decimals;
                }
            });
        }
    } catch (e) {
        /* ignore */
    }
}

function selectSymbolFromOrb(symbol) {
    subscribeDigits(symbol);
}

export async function initApexScanner() {
    if (initialized) return true;
    const ready = await waitForApi();
    if (!ready) {
        console.warn('[ApexScanner] Deriv API not ready - scanner globals not initialized yet.');
        return false;
    }

    window._digits = window._digits || [];
    window._higherTF = null;
    window.apexScan = apexScan;
    window.selectSymbolFromOrb = selectSymbolFromOrb;

    try {
        const raw = await fetchActiveSymbols();
        window.symbolsList = mapSymbols(raw);
        console.log(`[ApexScanner] Loaded ${window.symbolsList.length} live symbols from api_base.`);
    } catch (e) {
        console.error('[ApexScanner] Failed to load active symbols:', e);
        window.symbolsList = window.symbolsList || [];
    }

    initialized = true;
    window.ApexScannerReady = true;
    return true;
}

export { apexScan, analyze, analyzeDigits };
