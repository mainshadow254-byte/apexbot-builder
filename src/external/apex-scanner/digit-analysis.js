// ApexTraders digit-analysis engine - pure functions over a rolling tick sample.
// HONEST: these describe PAST ticks. On a fair RNG, past digits do not predict
// future digits. Use for visualization + discipline, not guaranteed prediction.

export function resolveDecimals(pipSizeVal, sampleQuoteStr) {
    if (pipSizeVal != null) {
        const v = Number(pipSizeVal);
        if (!isNaN(v)) {
            if (v > 0 && v < 1) return Math.round(-Math.log10(v));
            if (v >= 1 && v <= 8) return Math.round(v);
        }
    }
    if (sampleQuoteStr && sampleQuoteStr.indexOf('.') > -1) {
        return sampleQuoteStr.split('.')[1].length;
    }
    return 2;
}

export function lastDigitOf(quote, decimals) {
    const fixed = Number(quote).toFixed(decimals);
    return +fixed[fixed.length - 1];
}

export function digitStats(digits) {
    const counts = Array(10).fill(0);
    digits.forEach(d => counts[d]++);
    const total = digits.length || 1;
    const pct = counts.map(c => (c / total) * 100);
    const ranked = pct
        .map((p, d) => ({ digit: d, pct: p, count: counts[d] }))
        .sort((a, b) => b.pct - a.pct || a.digit - b.digit);
    return {
        counts,
        pct,
        total: digits.length,
        highest: ranked[0],
        secondHighest: ranked[1],
        lowest: ranked[ranked.length - 1],
        secondLowest: ranked[ranked.length - 2],
    };
}

export function evenOdd(digits) {
    const even = digits.filter(d => d % 2 === 0).length;
    const odd = digits.length - even;
    const total = digits.length || 1;
    return { even, odd, evenPct: (even / total) * 100, oddPct: (odd / total) * 100 };
}

// Deriv semantics: Over N wins if last digit > N; Under N wins if last digit < N.
export function overUnder(digits, barrier) {
    const over = digits.filter(d => d > barrier).length;
    const under = digits.filter(d => d < barrier).length;
    const equal = digits.filter(d => d === barrier).length;
    const total = digits.length || 1;
    return {
        barrier,
        over,
        under,
        equal,
        overPct: (over / total) * 100,
        underPct: (under / total) * 100,
    };
}

// Rise/Fall uses PRICE direction (not digits).
export function riseFall(prices) {
    let rise = 0,
        fall = 0,
        equal = 0;
    for (let i = 1; i < prices.length; i++) {
        if (prices[i] > prices[i - 1]) rise++;
        else if (prices[i] < prices[i - 1]) fall++;
        else equal++;
    }
    const total = rise + fall || 1;
    return { rise, fall, equal, risePct: (rise / total) * 100, fallPct: (fall / total) * 100 };
}

// Ticks since each digit last appeared (gap analysis - shown as observation only).
export function gaps(digits) {
    const result = [];
    for (let d = 0; d < 10; d++) {
        let gap = -1;
        for (let i = digits.length - 1, g = 0; i >= 0; i--, g++) {
            if (digits[i] === d) {
                gap = g;
                break;
            }
        }
        result.push({ digit: d, gap });
    }
    return result;
}

// Honest verdict: reports the strongest OBSERVED skew in the sample, with a clear
// truth flag. Never claims to predict the next tick.
export function honestVerdict(digits, prices) {
    if (!digits.length) return null;
    const eo = evenOdd(digits);
    const rf = riseFall(prices);
    const st = digitStats(digits);
    const notes = [];

    const eoLean = eo.evenPct >= eo.oddPct ? 'EVEN' : 'ODD';
    const eoEdge = Math.abs(eo.evenPct - eo.oddPct);
    notes.push(
        `Sample leans ${eoLean} (${eo.evenPct.toFixed(1)}% / ${eo.oddPct.toFixed(1)}%) over last ${digits.length} ticks.`
    );

    notes.push(
        `Most frequent digit: ${st.highest.digit} (${st.highest.pct.toFixed(1)}%). Least frequent: ${st.lowest.digit} (${st.lowest.pct.toFixed(1)}%).`
    );

    const rfLean = rf.risePct >= rf.fallPct ? 'RISE' : 'FALL';
    notes.push(`Recent price direction leans ${rfLean} (${rf.risePct.toFixed(1)}% / ${rf.fallPct.toFixed(1)}%).`);

    return {
        eoLean,
        eoEdge,
        rfLean,
        hotDigit: st.highest.digit,
        coldDigit: st.lowest.digit,
        notes,
        disclaimer:
            'Synthetic indices are RNG-based. These figures describe recent ticks only and do not predict future digits. Use for awareness and discipline, not guaranteed entries.',
    };
}
