/**
 * Smart AI Auto-Trader - standalone autonomous trading loop.
 * Reuses: window.apexScan (scanner), api_base.api.send({ buy }) (execution),
 * proposal_open_contract (settlement). Does NOT use Bot Builder XML.
 *
 * HONESTY: Rise/Fall uses the real scanner confidence. Digits are reserved for
 * a later phase because they are statistical only, never guaranteed.
 */
import { api_base } from '@/external/bot-skeleton';
import { analyzeDigits } from '@/external/apex-scanner/scanner';

const DIGIT_TYPES = ['Even / Odd', 'Over / Under', 'Matches / Differs'];

const CONTRACT_MAP = {
    RISE: 'CALL',
    FALL: 'PUT',
};

function scoreOverUnder(distribution, totalTicks) {
    const total = totalTicks || distribution.reduce((sum, count) => sum + count, 0) || 1;
    const freq = distribution.map(count => count / total);
    const candidates = [];

    for (let barrier = 0; barrier <= 8; barrier++) {
        const winDigits = [];
        for (let digit = barrier + 1; digit <= 9; digit++) winDigits.push(digit);
        const structural = winDigits.length / 10;
        const observed = winDigits.reduce((sum, digit) => sum + freq[digit], 0);
        const winProb = structural * 0.85 + observed * 0.15;
        candidates.push({ direction: 'OVER', barrier, winProb, structural });
    }

    for (let barrier = 1; barrier <= 9; barrier++) {
        const winDigits = [];
        for (let digit = 0; digit <= barrier - 1; digit++) winDigits.push(digit);
        const structural = winDigits.length / 10;
        const observed = winDigits.reduce((sum, digit) => sum + freq[digit], 0);
        const winProb = structural * 0.85 + observed * 0.15;
        candidates.push({ direction: 'UNDER', barrier, winProb, structural });
    }

    const banded = candidates.filter(candidate => candidate.winProb >= 0.55 && candidate.winProb <= 0.82);
    const pool = banded.length ? banded : candidates;
    pool.sort((a, b) => b.winProb - a.winProb);
    const best = pool[0];

    return {
        direction: best.direction,
        barrier: best.barrier,
        winProb: best.winProb,
        confidence: Math.round(best.winProb * 100),
        note: 'Structural odds (RNG) - not a prediction',
    };
}

function digitContractType(tradeType, direction) {
    if (tradeType === 'Over / Under') return direction === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
    if (tradeType === 'Even / Odd') return direction === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
    if (tradeType === 'Matches / Differs') return direction === 'MATCH' ? 'DIGITMATCH' : 'DIGITDIFF';
    return null;
}

const state = {
    running: false,
    settings: null,
    baseStake: 1,
    currentStake: 1,
    consecutiveLosses: 0,
    totalProfit: 0,
    runs: 0,
    won: 0,
    lost: 0,
    openContractId: null,
    pocSub: null,
    stopReason: null,
    listeners: new Set(),
};

function snapshot() {
    return {
        running: state.running,
        totalProfit: state.totalProfit,
        runs: state.runs,
        won: state.won,
        lost: state.lost,
        currentStake: state.currentStake,
        consecutiveLosses: state.consecutiveLosses,
        stopReason: state.stopReason,
    };
}

function emit(evt) {
    state.listeners.forEach(fn => {
        try {
            fn(evt, snapshot());
        } catch (e) {
            /* ignore listener failures */
        }
    });
}

export function onAutoTraderEvent(fn) {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
}

export function getAutoTraderState() {
    return snapshot();
}

function num(value, fallback = 0) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

function getCurrency() {
    try {
        return api_base?.account_info?.currency || 'USD';
    } catch (e) {
        return 'USD';
    }
}

function getMarkets(settings) {
    const source = window.symbolsList || api_base?.active_symbols || [];
    return (source || [])
        .map(s => ({
            ...s,
            symbol: s.symbol || s.underlying_symbol,
            display_name: s.display_name || s.underlying_symbol_name || s.symbol || s.underlying_symbol,
            market: s.market,
            exchange_is_open: typeof s.exchange_is_open === 'number' ? s.exchange_is_open : 1,
        }))
        .filter(s => s.symbol && (!settings.category || s.market === settings.category) && s.exchange_is_open !== 0)
        .slice(0, 20);
}

async function findEntry(settings) {
    if (typeof window.apexScan !== 'function') {
        emit({ type: 'tradeError', message: 'Scanner is not ready yet. Please wait a moment and try again.' });
        return null;
    }

    const isDigit = DIGIT_TYPES.includes(settings.tradeType);
    const markets = getMarkets(settings);
    if (!markets.length) {
        emit({ type: 'tradeError', message: 'No open markets found for this category.' });
        return null;
    }

    const scored = [];
    for (let i = 0; i < markets.length; i++) {
        if (!state.running) return null;
        emit({ type: 'scanning', index: i + 1, total: markets.length, name: markets[i].display_name });
        try {
            const v = await window.apexScan(markets[i].symbol, settings.tradeType);
            if (v && !v.noData) {
                scored.push({ symbol: markets[i].symbol, name: markets[i].display_name, v });
            }
        } catch (e) {
            /* ignore individual market failures */
        }
        await new Promise(resolve => setTimeout(resolve, 120));
    }

    if (!scored.length) {
        emit({ type: 'noEntry', bestConfidence: 0, threshold: settings.safeMode ? 75 : 60 });
        return null;
    }

    if (isDigit) {
        if (settings.tradeType !== 'Over / Under') {
            emit({
                type: 'tradeError',
                message: 'Even/Odd & Matches/Differs auto-trading arrive next. Use Over/Under or Rise/Fall.',
            });
            return null;
        }

        const rows = [];
        for (const item of scored) {
            const dist =
                item.v?.digit?.distribution ||
                (typeof analyzeDigits === 'function' ? analyzeDigits(window._digits || [])?.distribution : null);
            if (!dist) continue;
            const totalTicks = dist.reduce((sum, count) => sum + count, 0);
            if (totalTicks < 20) continue;
            const overUnder = scoreOverUnder(dist, totalTicks);
            rows.push({ symbol: item.symbol, name: item.name, ...overUnder });
        }

        if (!rows.length) {
            emit({ type: 'noEntry', bestConfidence: 0, threshold: 0 });
            return null;
        }

        rows.sort((a, b) => b.winProb - a.winProb);
        emit({
            type: 'scanTable',
            digit: true,
            rows: rows.map(row => ({
                name: row.name,
                symbol: row.symbol,
                entry: `${row.direction} ${row.barrier}`,
                confidence: row.confidence,
                note: row.note,
            })),
        });

        const best = rows[0];
        const threshold = settings.safeMode ? 72 : 60;
        if (best.confidence < threshold) {
            emit({ type: 'noEntry', bestConfidence: best.confidence, threshold });
            return null;
        }

        return {
            symbol: best.symbol,
            name: best.name,
            tradeType: 'Over / Under',
            direction: best.direction,
            barrier: best.barrier,
            confidence: best.confidence,
        };
    }

    scored.sort((a, b) => (b.v.score || 0) - (a.v.score || 0));

    emit({
        type: 'scanTable',
        rows: scored.map(s => ({
            name: s.name,
            symbol: s.symbol,
            direction: s.v.direction === 'CALL' ? 'RISE' : 'FALL',
            confidence: Math.round(s.v.confidence || s.v.score || 0),
            wait: Boolean(s.v.wait),
        })),
    });

    const best = scored[0];
    const confidence = Math.round(best.v.confidence || best.v.score || 0);
    const threshold = settings.safeMode ? 75 : 60;

    if (best.v.wait || (best.v.contradictions || 0) >= 2 || confidence < threshold) {
        emit({ type: 'noEntry', bestConfidence: confidence, threshold });
        return null;
    }

    return {
        symbol: best.symbol,
        name: best.name,
        tradeType: 'Rise / Fall',
        direction: best.v.direction === 'CALL' ? 'RISE' : 'FALL',
        confidence,
    };
}

function cleanupContractSubscription() {
    if (state.pocSub && typeof state.pocSub.unsubscribe === 'function') {
        try {
            state.pocSub.unsubscribe();
        } catch (e) {
            /* ignore */
        }
    }
    state.pocSub = null;
}

function placeTrade(entry, settings) {
    return new Promise(resolve => {
        const currency = getCurrency();
        const amount = state.currentStake;
        const duration = Math.max(1, Math.round(num(settings.duration, 1)));
        const isDigit = DIGIT_TYPES.includes(entry.tradeType);
        const contract_type = isDigit ? digitContractType(entry.tradeType, entry.direction) : CONTRACT_MAP[entry.direction];

        cleanupContractSubscription();

        const buyReq = {
            buy: '1',
            price: amount,
            parameters: {
                amount,
                basis: 'stake',
                contract_type,
                currency,
                duration,
                duration_unit: 't',
                underlying_symbol: entry.symbol,
            },
        };

        if (isDigit && entry.barrier !== undefined && entry.barrier !== null) {
            buyReq.parameters.barrier = String(entry.barrier);
            buyReq.parameters.selected_tick = entry.barrier;
        }

        emit({ type: 'placing', entry, stake: amount });

        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            cleanupContractSubscription();
            state.openContractId = null;
            resolve(result);
        };

        const timeout = setTimeout(() => {
            finish({ error: true, message: 'Contract settlement timed out' });
        }, 45000);

        api_base.api
            .send(buyReq)
            .then(res => {
                if (res?.error) {
                    clearTimeout(timeout);
                    emit({ type: 'tradeError', message: res.error.message });
                    finish({ error: true });
                    return;
                }

                const contract_id = res?.buy?.contract_id;
                if (!contract_id) {
                    clearTimeout(timeout);
                    emit({ type: 'tradeError', message: 'No contract id returned' });
                    finish({ error: true });
                    return;
                }

                state.openContractId = contract_id;

                const stream = api_base.api.onMessage && api_base.api.onMessage();
                if (stream && stream.subscribe) {
                    state.pocSub = stream.subscribe(({ data }) => {
                        if (
                            data &&
                            data.msg_type === 'proposal_open_contract' &&
                            data.proposal_open_contract &&
                            String(data.proposal_open_contract.contract_id) === String(contract_id)
                        ) {
                            const contract = data.proposal_open_contract;
                            if (
                                contract.is_sold ||
                                contract.status === 'sold' ||
                                contract.status === 'won' ||
                                contract.status === 'lost'
                            ) {
                                clearTimeout(timeout);
                                finish({ profit: num(contract.profit, 0), contract });
                            }
                        }
                    });
                }

                api_base.api
                    .send({ proposal_open_contract: 1, contract_id, subscribe: 1 })
                    .catch(() => {});
            })
            .catch(err => {
                clearTimeout(timeout);
                emit({ type: 'tradeError', message: err?.message || 'buy failed' });
                finish({ error: true });
            });
    });
}

async function loop() {
    while (state.running) {
        const entry = await findEntry(state.settings);
        if (!state.running) break;

        if (!entry) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
        }

        const result = await placeTrade(entry, state.settings);
        if (!state.running) break;

        if (result.error) {
            if (result.message) emit({ type: 'tradeError', message: result.message });
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
        }

        state.runs += 1;
        state.totalProfit += result.profit;

        const isWin = result.profit >= 0;
        if (isWin) {
            state.won += 1;
            state.consecutiveLosses = 0;
            state.currentStake = state.baseStake;
        } else {
            state.lost += 1;
            state.consecutiveLosses += 1;
            if (state.settings.martingale) {
                const multiplier = num(state.settings.multiplier, 2);
                let nextStake = state.currentStake * multiplier;
                const maxStake = num(state.settings.maxStake, 0);
                if (maxStake > 0 && nextStake > maxStake) nextStake = maxStake;
                state.currentStake = nextStake;
            }
        }

        emit({ type: 'settled', profit: result.profit, isWin, ...snapshot() });

        const takeProfit = num(state.settings.takeProfit, 0);
        const stopLoss = num(state.settings.stopLoss, 0);
        if (takeProfit > 0 && state.totalProfit >= takeProfit) {
            state.stopReason = { kind: 'takeProfit', amount: state.totalProfit };
            stop('takeProfit');
            break;
        }
        if (stopLoss > 0 && state.totalProfit <= -stopLoss) {
            state.stopReason = { kind: 'stopLoss', amount: state.totalProfit };
            stop('stopLoss');
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 800));
    }
}

export function startAutoTrader(settings) {
    if (state.running) return;

    if (!api_base?.api) {
        emit({ type: 'tradeError', message: 'Not connected / not logged in' });
        return;
    }

    const tradeType = settings.tradeType || 'Rise / Fall';
    const allowed = ['Rise / Fall', 'Over / Under'];
    if (!allowed.includes(tradeType)) {
        emit({
            type: 'tradeError',
            message: `${tradeType} auto-trading arrives in the next update. Use Rise/Fall or Over/Under.`,
        });
        return;
    }

    state.settings = { ...settings, tradeType };
    state.baseStake = num(settings.stake, 1);
    state.currentStake = state.baseStake;
    state.consecutiveLosses = 0;
    state.totalProfit = 0;
    state.runs = 0;
    state.won = 0;
    state.lost = 0;
    state.stopReason = null;
    state.running = true;

    emit({ type: 'started', ...snapshot() });
    loop();
}

export function stop(reason) {
    if (!state.running && !reason) return;
    state.running = false;
    cleanupContractSubscription();
    emit({ type: 'stopped', reason: reason || 'manual', stopReason: state.stopReason, ...snapshot() });
}

export function stopAutoTrader() {
    state.stopReason = state.stopReason || { kind: 'manual' };
    stop('manual');
}
