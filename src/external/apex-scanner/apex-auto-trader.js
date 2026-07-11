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

const BATCH_SIZE = 5;
const BATCH_GAP_MS = 60;

/**
 * HONEST Over/Under scorer - ranks by EDGE over the RNG baseline, not raw win-%.
 * edge = observedWinFrequency - structuralWinProbability.
 * A market only "stands out" if recent digits deviate favorably from random.
 * We still surface the TRUE win-% so the payout/risk trade-off stays honest.
 */
function scoreOverUnder(distribution, totalTicks) {
    const total = totalTicks || distribution.reduce((a, b) => a + b, 0) || 1;
    const freq = distribution.map(c => c / total);

    const candidates = [];
    for (let n = 0; n <= 8; n++) {
        const winDigits = [];
        for (let d = n + 1; d <= 9; d++) winDigits.push(d);
        const structural = winDigits.length / 10;
        const observed = winDigits.reduce((sum, d) => sum + freq[d], 0);
        candidates.push({ direction: 'OVER', barrier: n, structural, observed, edge: observed - structural });
    }
    for (let n = 1; n <= 9; n++) {
        const winDigits = [];
        for (let d = 0; d <= n - 1; d++) winDigits.push(d);
        const structural = winDigits.length / 10;
        const observed = winDigits.reduce((sum, d) => sum + freq[d], 0);
        candidates.push({ direction: 'UNDER', barrier: n, structural, observed, edge: observed - structural });
    }

    // Keep a sensible win-% band (avoid tiny-payout 90% and risky <50%),
    // then rank by EDGE (favorable deviation from random) within that band.
    const banded = candidates.filter(c => c.structural >= 0.5 && c.structural <= 0.8);
    const pool = banded.length ? banded : candidates;
    pool.sort((a, b) => b.edge - a.edge);
    const best = pool[0];

    // Confidence shown = the TRUE structural win-% blended slightly with observed.
    const winProb = best.structural * 0.85 + best.observed * 0.15;
    return {
        direction: best.direction,
        barrier: best.barrier,
        winProb,
        edge: best.edge,
        confidence: Math.round(winProb * 100),
        edgePct: Math.round(best.edge * 1000) / 10,
        lowPayout: best.structural >= 0.7,
        riskWarning: best.structural >= 0.75 ? 'High win-rate but small payout - losses cost more than wins pay.' : '',
        note: 'Structural odds (RNG) - ranked by recent edge, not a prediction',
    };
}

/**
 * Even/Odd - inherently ~50/50. We surface the recent lean but CAP it honestly.
 * There is no real predictive edge here; we rank by mild recent deviation only
 * and label it clearly as near-random.
 */
function scoreEvenOdd(distribution, totalTicks) {
    const total = totalTicks || distribution.reduce((a, b) => a + b, 0) || 1;
    let even = 0;
    for (let d = 0; d <= 9; d++) if (d % 2 === 0) even += distribution[d];
    const evenFreq = even / total;
    const oddFreq = 1 - evenFreq;
    const direction = evenFreq >= oddFreq ? 'EVEN' : 'ODD';
    const observed = Math.max(evenFreq, oddFreq);
    const edge = observed - 0.5;
    return {
        direction,
        barrier: undefined,
        winProb: observed,
        edge,
        confidence: Math.round(observed * 100),
        edgePct: Math.round(edge * 1000) / 10,
        lowPayout: false,
        riskWarning: '',
        note: 'Even/Odd is ~50/50 (RNG) - recent lean only, essentially random',
    };
}

/**
 * Matches/Differs - DIGITDIFF wins 9/10 by structure (~90%, tiny payout);
 * DIGITMATCH wins ~1/10. We pick the least-frequent digit for DIFFERS so the
 * observed differs-win frequency is highest. Honest odds, not a prediction.
 */
function scoreMatchesDiffers(distribution, totalTicks) {
    const total = totalTicks || distribution.reduce((a, b) => a + b, 0) || 1;
    const freq = distribution.map(c => c / total);

    // Predict the LEAST-frequent digit for DIFFERS (least likely to be matched).
    let minD = 0;
    for (let d = 1; d <= 9; d++) if (freq[d] < freq[minD]) minD = d;

    const observedDiffersWin = 1 - freq[minD];
    const structuralDiffers = 0.9;
    const edge = observedDiffersWin - structuralDiffers;
    const winProb = structuralDiffers * 0.9 + observedDiffersWin * 0.1;
    const approxPayoutRatio = 0.11;

    return {
        direction: 'DIFFERS',
        barrier: minD,
        winProb,
        edge,
        confidence: Math.round(winProb * 100),
        edgePct: Math.round(edge * 1000) / 10,
        payoutRatio: approxPayoutRatio,
        lowPayout: true,
        riskWarning: 'High win-rate, TINY payout - one loss erases many wins. Martingale risk is severe here.',
        note: 'Differs ~90% structural (tiny payout) - honest odds, not a prediction',
    };
}

function digitContractType(tradeType, direction) {
    if (tradeType === 'Over / Under') return direction === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
    if (tradeType === 'Even / Odd') return direction === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
    if (tradeType === 'Matches / Differs') return direction === 'MATCH' ? 'DIGITMATCH' : 'DIGITDIFF';
    return null;
}

function scoreDigitDistribution(tradeType, dist) {
    if (!dist) return null;
    const totalTicks = dist.reduce((sum, count) => sum + count, 0);
    if (totalTicks < 20) return null;
    if (tradeType === 'Over / Under') return scoreOverUnder(dist, totalTicks);
    if (tradeType === 'Even / Odd') return scoreEvenOdd(dist, totalTicks);
    if (tradeType === 'Matches / Differs') return scoreMatchesDiffers(dist, totalTicks);
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
    differsRiskWarned: false,
    listeners: new Set(),
};

// Conviction: require the same signal to persist across N consecutive scans.
const conviction = {
    lastKey: null,
    streak: 0,
};
const REQUIRED_STREAK = 3; // stronger conviction, fewer/surer entries

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

function resetConviction() {
    conviction.lastKey = null;
    conviction.streak = 0;
}

function requireConviction(candidate) {
    const key = `${candidate.tradeType}|${candidate.symbol}|${candidate.direction}${
        candidate.barrier !== undefined ? ` ${candidate.barrier}` : ''
    }`;
    if (conviction.lastKey === key) {
        conviction.streak += 1;
    } else {
        conviction.lastKey = key;
        conviction.streak = 1;
    }

    if (conviction.streak < REQUIRED_STREAK) {
        emit({ type: 'confirming', key, streak: conviction.streak, required: REQUIRED_STREAK, name: candidate.name });
        return null;
    }

    resetConviction();
    return candidate;
}

function decimalsFromPip(pip, fallback = 2) {
    if (typeof pip !== 'number' || !Number.isFinite(pip)) return fallback;
    if (pip >= 1) return Math.max(0, Math.round(pip));
    return Math.max(0, Math.round(Math.log10(1 / pip)));
}

async function fetchDigitDistribution(symbol, count = 1000) {
    const response = await api_base.api.send({
        ticks_history: symbol,
        style: 'ticks',
        count,
        end: 'latest',
        adjust_start_time: 1,
    });
    const prices = response?.history?.prices || [];
    const decimals = decimalsFromPip(response?.pip_size);
    return analyzeDigits(prices.map(p => Number(p).toFixed(decimals)));
}

async function findEntry(settings) {
    if (typeof window.apexScan !== 'function') {
        emit({ type: 'tradeError', message: 'Scanner is not ready yet. Please wait a moment and try again.' });
        return null;
    }

    const isDigit = DIGIT_TYPES.includes(settings.tradeType);
    let markets = getMarkets(settings);

    // Rise/Fall: prefer calmer volatility indices, exclude spike markets (Boom/Crash/Jump)
    // which are devastating for martingale and don't mean-revert cleanly.
    if (settings.tradeType === 'Rise / Fall') {
        const isVolatility = sym => /^R_\d+$/.test(String(sym)) || /^1HZ\d+V$/.test(String(sym));
        const preferOrder = ['R_10', '1HZ10V', 'R_25', '1HZ25V', 'R_50', '1HZ50V', 'R_75', '1HZ75V', 'R_100', '1HZ100V'];
        markets = markets.filter(m => isVolatility(m.symbol));
        markets.sort((a, b) => {
            const ia = preferOrder.indexOf(a.symbol);
            const ib = preferOrder.indexOf(b.symbol);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
    }

    const isDigitCapable = s => {
        const sym = String(s.symbol || '');
        return /^R_\d+$/.test(sym) || /^1HZ\d+V$/.test(sym);
    };

    if (isDigit) {
        markets = markets.filter(isDigitCapable);
    }

    if (isDigit && !markets.length) {
        emit({
            type: 'tradeError',
            message:
                'No digit-capable Volatility markets available right now. (Digits only trade on Volatility indices, not Boom/Crash/Jump.)',
        });
        return null;
    }

    if (!markets.length) {
        emit({ type: 'tradeError', message: 'No open markets found for this category.' });
        return null;
    }

    if (isDigit) {
        const rows = [];
        for (let i = 0; i < markets.length; i += BATCH_SIZE) {
            if (!state.running) return null;
            const batch = markets.slice(i, i + BATCH_SIZE);
            emit({
                type: 'scanning',
                index: Math.min(i + BATCH_SIZE, markets.length),
                total: markets.length,
                name: batch[0]?.display_name || '',
            });
            const results = await Promise.all(batch.map(async m => {
                try {
                    const digitData = await fetchDigitDistribution(m.symbol);
                    const score = scoreDigitDistribution(settings.tradeType, digitData?.distribution);
                    return score ? { symbol: m.symbol, name: m.display_name, ...score } : null;
                } catch (e) {
                    return null;
                }
            }));
            results.forEach(r => {
                if (r) rows.push(r);
            });
            await new Promise(resolve => setTimeout(resolve, BATCH_GAP_MS));
        }

        if (!rows.length) {
            emit({ type: 'noEntry', bestConfidence: 0, threshold: 0 });
            return null;
        }

        rows.sort((a, b) => b.edge - a.edge || b.winProb - a.winProb);
        emit({
            type: 'scanTable',
            digit: true,
            rows: rows.map(row => ({
                name: row.name,
                symbol: row.symbol,
                entry: row.barrier !== undefined ? `${row.direction} ${row.barrier}` : row.direction,
                confidence: row.confidence,
                edgePct: row.edgePct,
                lowPayout: !!row.lowPayout,
                note: row.note,
            })),
        });

        const best = rows[0];
        const threshold = settings.safeMode ? 72 : 55;
        if (best.confidence < threshold || (settings.safeMode && best.edge < 0)) {
            emit({ type: 'noEntry', bestConfidence: best.confidence, threshold });
            return null;
        }

        const candidate = {
            symbol: best.symbol,
            name: best.name,
            tradeType: settings.tradeType,
            direction: best.direction,
            barrier: best.barrier,
            confidence: best.confidence,
        };
        return requireConviction(candidate);
    }

    const scored = [];
    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
        if (!state.running) return null;
        const batch = markets.slice(i, i + BATCH_SIZE);
        emit({
            type: 'scanning',
            index: Math.min(i + BATCH_SIZE, markets.length),
            total: markets.length,
            name: batch[0]?.display_name || '',
        });
        const results = await Promise.all(batch.map(async m => {
            try {
                const v = await window.apexScan(m.symbol, settings.tradeType);
                return v && !v.noData ? { symbol: m.symbol, name: m.display_name, v } : null;
            } catch (e) {
                return null;
            }
        }));
        results.forEach(r => {
            if (r) scored.push(r);
        });
        await new Promise(resolve => setTimeout(resolve, BATCH_GAP_MS));
    }

    if (!scored.length) {
        emit({ type: 'noEntry', bestConfidence: 0, threshold: settings.safeMode ? 75 : 60 });
        return null;
    }

    // ---- Rise/Fall CONVICTION gate ----
    scored.sort((a, b) => (b.v.score || 0) - (a.v.score || 0));
    emit({
        type: 'scanTable',
        rows: scored.map(s => ({
            name: s.name,
            symbol: s.symbol,
            direction: s.v.direction === 'CALL' ? 'RISE' : 'FALL',
            confidence: Math.round(s.v.confidence || 0),
            score: Math.round(s.v.score || 0),
            wait: Boolean(s.v.wait),
        })),
    });

    const best = scored[0];
    const v = best.v;
    const scoreVal = Math.round(v.score || 0);
    const confVal = Math.round(v.confidence || 0);
    const minScore = settings.safeMode ? 78 : 70;
    const minConf = settings.safeMode ? 65 : 55;
    const passesConviction =
        !v.wait && (v.contradictions || 0) === 0 && scoreVal >= minScore && confVal >= minConf;

    if (!passesConviction) {
        emit({
            type: 'noEntry',
            bestConfidence: confVal,
            threshold: minConf,
            detail: `score ${scoreVal}/${minScore}, conf ${confVal}/${minConf}, contradictions ${
                v.contradictions || 0
            }`,
        });
        return null;
    }

    const candidate = {
        symbol: best.symbol,
        name: best.name,
        tradeType: 'Rise / Fall',
        direction: v.direction === 'CALL' ? 'RISE' : 'FALL',
        confidence: confVal,
        score: scoreVal,
    };
    return requireConviction(candidate);
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
                    emit({
                        type: 'tradeError',
                        message: `Buy rejected: ${res.error.message}${res.error.code ? ` [${res.error.code}]` : ''}`,
                    });
                    // eslint-disable-next-line no-console
                    console.warn('[ApexAI] buy rejected:', res.error, 'payload:', buyReq.parameters);
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
                emit({ type: 'tradeError', message: `Buy failed: ${err?.message || 'unknown'}` });
                // eslint-disable-next-line no-console
                console.warn('[ApexAI] buy exception:', err, 'payload:', buyReq.parameters);
                finish({ error: true });
            });
    });
}

async function loop() {
    while (state.running) {
        const entry = await findEntry(state.settings);
        if (!state.running) break;

        if (!entry) {
            await new Promise(resolve => setTimeout(resolve, 600));
            continue;
        }

        // SL overshoot guard: don't fire a stake that would blow past Stop Loss.
        const slLimit = num(state.settings.stopLoss, 0);
        if (slLimit > 0) {
            const worstCase = state.totalProfit - state.currentStake;
            if (worstCase <= -slLimit) {
                state.stopReason = { kind: 'stopLoss', amount: state.totalProfit };
                emit({
                    type: 'staleSkip',
                    message: `Stop Loss guard: next stake (${state.currentStake}) could exceed your limit. Stopping to protect capital.`,
                });
                stop('stopLoss');
                break;
            }
        }

        let confirmed = entry;
        try {
            if (state.settings.tradeType === 'Rise / Fall') {
                const fresh = await window.apexScan(entry.symbol, state.settings.tradeType);
                if (fresh && !fresh.noData) {
                    const freshDir = fresh.direction === 'CALL' ? 'RISE' : 'FALL';
                    const freshConf = Math.round(fresh.confidence || fresh.score || 0);
                    const freshScore = Math.round(fresh.score || 0);
                    const minScore = state.settings.safeMode ? 78 : 70;
                    const minConf = state.settings.safeMode ? 65 : 55;
                    if (
                        freshDir !== entry.direction ||
                        fresh.wait ||
                        (fresh.contradictions || 0) !== 0 ||
                        freshScore < minScore ||
                        freshConf < minConf
                    ) {
                        emit({ type: 'staleSkip', message: `Signal changed on ${entry.name} - skipping for a fresher entry.` });
                        await new Promise(resolve => setTimeout(resolve, 300));
                        continue;
                    }
                    confirmed = { ...entry, confidence: freshConf, score: freshScore };
                }
            } else if (DIGIT_TYPES.includes(state.settings.tradeType)) {
                const digitData = await fetchDigitDistribution(entry.symbol);
                const sc = scoreDigitDistribution(state.settings.tradeType, digitData?.distribution);
                const gate = state.settings.safeMode ? 72 : 55;
                if (!sc || sc.confidence < gate) {
                    emit({ type: 'staleSkip', message: 'Digit edge faded - rescanning.' });
                    await new Promise(resolve => setTimeout(resolve, 300));
                    continue;
                }
                confirmed = { ...entry, direction: sc.direction, barrier: sc.barrier, confidence: sc.confidence };
            }
        } catch (e) {
            /* if re-verify fails, fall back to original entry */
        }

        const result = await placeTrade(confirmed, state.settings);
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
                if (state.settings.tradeType === 'Matches / Differs' && !state.differsRiskWarned) {
                    state.differsRiskWarned = true;
                    emit({
                        type: 'riskWarning',
                        message:
                            'Differs loss triggered martingale - recovery requires many tiny wins. Consider disabling martingale for Differs.',
                    });
                }
            }
        }

        emit({ type: 'settled', profit: result.profit, isWin, ...snapshot() });

        // Pro risk mgmt: halt a bad streak before it compounds.
        if (!isWin) {
            const maxStreak = num(state.settings.maxLossStreak, 4);
            if (maxStreak > 0 && state.consecutiveLosses >= maxStreak) {
                state.stopReason = { kind: 'lossStreak', amount: state.totalProfit, streak: state.consecutiveLosses };
                emit({
                    type: 'staleSkip',
                    message: `Auto-halt: ${state.consecutiveLosses} losses in a row - stopping to protect capital.`,
                });
                stop('lossStreak');
                break;
            }
        }

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

        await new Promise(resolve => setTimeout(resolve, 300));
    }
}

export function startAutoTrader(settings) {
    if (state.running) return;

    if (!api_base?.api) {
        emit({ type: 'tradeError', message: 'Not connected / not logged in' });
        return;
    }

    const tradeType = settings.tradeType || 'Rise / Fall';
    const allowed = ['Rise / Fall', 'Over / Under', 'Even / Odd', 'Matches / Differs'];
    if (!allowed.includes(tradeType)) {
        emit({
            type: 'tradeError',
            message: `${tradeType} auto-trading is not available yet. Use Rise/Fall or a supported digit type.`,
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
    state.differsRiskWarned = false;
    resetConviction();
    state.running = true;

    emit({ type: 'started', ...snapshot() });
    loop();
}

export function stop(reason) {
    if (!state.running && !reason) return;
    state.running = false;
    resetConviction();
    cleanupContractSubscription();
    emit({ type: 'stopped', reason: reason || 'manual', stopReason: state.stopReason, ...snapshot() });
}

export function stopAutoTrader() {
    state.stopReason = state.stopReason || { kind: 'manual' };
    stop('manual');
}
