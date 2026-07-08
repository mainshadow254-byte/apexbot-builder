// ApexTraders AI Scanner data bridge.
// Feeds the orb + scanner from the template's SINGLE authenticated api_base
// connection (same socket used for login/charts/trading) - no second WebSocket.
// Exposes the window.* globals the ported orb.js expects.

import { api_base } from '@/external/bot-skeleton';
import { analyze, analyzeDigits } from './scanner';

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

async function apexScan(symbol) {
    const r = await getCandles(symbol, { count: CANDLE_COUNT });

    // Guard: no candles = market closed or no data available (forex/commodities
    // close on weekends/off-hours; synthetics are 24/7 and always return data).
    if (!r || !r.candles || r.candles.length === 0) {
        return { noData: true, symbol };
    }

    let higher = null;
    try {
        const h = await getCandles(symbol, { granularity: HIGHER_TF_GRANULARITY, count: HIGHER_TF_COUNT });
        higher = h.candles;
    } catch (e) {
        /* higher timeframe optional */
    }
    const digits = symbol === currentTickSymbol ? window._digits || [] : [];
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
                    window._digits = window._digits || [];
                    window._digits.push(data.tick.quote);
                    if (window._digits.length > 100) window._digits.shift();
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
