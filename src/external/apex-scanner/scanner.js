import { TA } from "./indicators.js";

export function safetyColor(s) {
  if (s >= 78) return { key: "blue", label: "PRIME", css: "#3d8bff" };
  if (s >= 60) return { key: "green", label: "SAFE", css: "#2fe38b" };
  if (s >= 45) return { key: "amber", label: "WAIT", css: "#ffb547" };
  return { key: "red", label: "RISKY", css: "#ff5d73" };
}

// Digit bias from a live last-digit tick buffer (Deriv real ticks, not hardcoded).
export function analyzeDigits(ticks) {
  if (!ticks || ticks.length < 20) return null;
  const digits = ticks.map(t => {
    const clean = String(t).replace(/[^0-9]/g, '');
    return clean.length ? +clean[clean.length - 1] : 0;
  });
  const counts = Array(10).fill(0); digits.forEach(d => counts[d]++);
  const even = digits.filter(d => d % 2 === 0).length, odd = digits.length - even;
  const overs = digits.filter(d => d > 5).length, unders = digits.filter(d => d < 5).length;
  const predicted = counts.indexOf(Math.max(...counts));
  return {
    parity: even >= odd ? "even" : "odd",
    overUnder: overs >= unders ? "over" : "under",
    predicted, distribution: counts,
    reason: `Digit stats - even ${even} vs odd ${odd}; most frequent last digit ${predicted}.`,
  };
}

/**
 * MEAN-REVERSION engine for short-duration synthetic Rise/Fall.
 * Research-backed: 1-tick synthetics revert from extremes rather than trend.
 * Scores reversion signals; fires FALL from overbought highs, RISE from oversold lows.
 * `ticks` = raw price array (preferred). `candles` used for RSI/BB context.
 */
export function analyzeReversion(ticks, candles) {
  const px = (ticks && ticks.length >= 30) ? ticks.map(Number) : (candles || []).map(c => +c.close);
  if (!px || px.length < 30) return null;

  const price = px[px.length - 1];
  const rsi = TA.rsi(px, 14);
  const bb = TA.bollinger(px, 20, 2);
  const roc = TA.roc(px, 5);
  const hi20 = TA.highest(px, 20);
  const lo20 = TA.lowest(px, 20);
  // Direction of the latest move (must be the actual last tick, not any tick in the recent window).
  const prev = px[px.length - 2];
  const prior = px[px.length - 3];
  const prePrior = px[px.length - 4];
  const latestUp = price > prev;
  const latestDown = price < prev;
  const recent4 = px.slice(-4);
  const recentHigh = Math.max(...recent4);
  const recentLow = Math.min(...recent4);

  // Tick reversal confirmation: the final tick must turn against the prior push.
  // This avoids the old false-positive where any earlier down/up tick in the last
  // three moves counted as a reversal even if the latest tick was still extending.
  const hadUpPush = prev > prior || prior > prePrior;
  const hadDownPush = prev < prior || prior < prePrior;
  const fallReversal = latestDown && hadUpPush;
  const riseReversal = latestUp && hadDownPush;

  let fall = 0, rise = 0;
  const reasons = [];

  // --- FALL signals (bet against an overbought top) ---
  const rsiFall = rsi != null && rsi >= 70;
  const bbFall = bb && recentHigh >= bb.upper;
  const localHighFall = hi20 != null && recentHigh >= hi20;
  if (rsiFall) { fall += 3; reasons.push({ ok: true, txt: `RSI ${rsi.toFixed(0)} overbought - reversion FALL.` }); }
  if (bbFall) { fall += 3; reasons.push({ ok: true, txt: `Recent tick touched upper Bollinger - reversion FALL.` }); }
  if (roc != null && roc > 0 && roc < 0.03) { fall += 2; reasons.push({ ok: true, txt: `Upward momentum fading - reversion FALL.` }); }
  if (fallReversal) { fall += 2; reasons.push({ ok: true, txt: `Latest tick reversed downward after an up-push - momentum FALL.` }); }
  if (localHighFall) { fall += 1; reasons.push({ ok: true, txt: `Recent tick hit 20-tick local high - stretched, FALL.` }); }

  // --- RISE signals (bet against an oversold bottom) ---
  const rsiRise = rsi != null && rsi <= 30;
  const bbRise = bb && recentLow <= bb.lower;
  const localLowRise = lo20 != null && recentLow <= lo20;
  if (rsiRise) { rise += 3; reasons.push({ ok: true, txt: `RSI ${rsi.toFixed(0)} oversold - reversion RISE.` }); }
  if (bbRise) { rise += 3; reasons.push({ ok: true, txt: `Recent tick touched lower Bollinger - reversion RISE.` }); }
  if (roc != null && roc < 0 && roc > -0.03) { rise += 2; reasons.push({ ok: true, txt: `Downward momentum fading - reversion RISE.` }); }
  if (riseReversal) { rise += 2; reasons.push({ ok: true, txt: `Latest tick reversed upward after a down-push - momentum RISE.` }); }
  if (localLowRise) { rise += 1; reasons.push({ ok: true, txt: `Recent tick hit 20-tick local low - stretched, RISE.` }); }

  const top = Math.max(fall, rise);
  const direction = fall >= rise ? 'PUT' : 'CALL';   // PUT = FALL, CALL = RISE
  const opposite = direction === 'PUT' ? rise : fall;

  // 2-of-3 extreme confluence (RSI, Bollinger, local extreme) plus latest-tick reversal.
  const fallExtremeVotes = Number(rsiFall) + Number(Boolean(bbFall)) + Number(localHighFall);
  const riseExtremeVotes = Number(rsiRise) + Number(Boolean(bbRise)) + Number(localLowRise);
  const fallConfluence = fallExtremeVotes >= 2 && fallReversal;
  const riseConfluence = riseExtremeVotes >= 2 && riseReversal;
  const coreConfluence = (direction === 'PUT' && fallConfluence) || (direction === 'CALL' && riseConfluence);
  const MIN_SCORE = 6;
  const strong = top >= MIN_SCORE && top >= opposite + 3 && coreConfluence;

  // Confidence: a valid fire lands ~60-75 (top 6->67, 7->78, cap 100). Non-strong stays low.
  let confidence = Math.round(Math.min(1, top / 9) * 100);
  if (!strong) confidence = Math.min(confidence, 45);
  confidence = Math.max(0, Math.min(100, confidence));

  const wait = !strong;
  const contradictions = strong ? 0 : 1;             // valid fire => 0 (passes gate)
  const score = Math.max(0, Math.min(100, Math.round(52 + (top - opposite) * 6)));
  const color = strong
    ? { key: 'green', label: 'SAFE', css: '#2fe38b' }
    : { key: 'amber', label: 'WAIT', css: '#ffb547' };
  if (!strong) reasons.push({ ok: false, txt: 'WAIT - reversion not confirmed at a true extreme.' });

  return {
    score, color, direction, confidence, contradictions, wait, reasons,
    reversion: true,
    metrics: {
      rsi, roc, price, bbUpper: bb?.upper, bbLower: bb?.lower,
      fallExtremeVotes, riseExtremeVotes, fallReversal, riseReversal,
    },
  };
}

// Core AI Safe-Entry scanner. Accepts real Deriv candles + optional digit/higher-timeframe data.
// This is the ONLY function that decides trade direction/safety at runtime - the Bot Builder
// (Phase 6) will supply extra `conditions[]` that trader.js (Phase 3) checks ON TOP of this,
// never as a replacement for it.
export function analyze(candles, digitData = null, higherTF = null) {
  const close = candles.map(c => +c.close), high = candles.map(c => +c.high), low = candles.map(c => +c.low);
  const rsi = TA.rsi(close, 14), atr = TA.atr(high, low, close, 14), adxO = TA.adx(high, low, close, 14);
  const macd = TA.macd(close), bb = TA.bollinger(close, 20, 2), stoch = TA.stochastic(high, low, close, 14);
  const ema20 = TA.ema(close, 20), ema50 = TA.ema(close, 50), ema200 = TA.ema(close, 200);
  const price = close[close.length - 1];
  let score = 50; const reasons = []; let bull = 0, bear = 0; let htfAligned = null;

  // --- Market-quality factors (direction-neutral: is this tradeable at all?) ---
  if (adxO) {
    if (adxO.adx >= 25) { score += 15; reasons.push({ ok: true, txt: `Strong trend - ADX ${adxO.adx.toFixed(0)} (>25). Directional, not choppy.` }); adxO.plusDI > adxO.minusDI ? bull += 2 : bear += 2; }
    else if (adxO.adx < 18) { score -= 15; reasons.push({ ok: false, txt: `Choppy - ADX ${adxO.adx.toFixed(0)} (<18). High whipsaw risk.` }); }
  }
  if (atr) {
    const p = (atr / price) * 100;
    if (p < 0.15) { score += 10; reasons.push({ ok: true, txt: `Low volatility - ATR ${p.toFixed(2)}% of price. Calm.` }); }
    else if (p > 0.5) { score -= 16; reasons.push({ ok: false, txt: `High volatility - ATR ${p.toFixed(2)}%. Erratic swings.` }); }
  }
  if (bb && bb.width < 0.01) { score += 6; reasons.push({ ok: true, txt: "Bollinger squeeze - stable range." }); }

  // --- Directional votes ---
  if (ema20 && ema50) {
    if (ema20 > ema50) { bull++; reasons.push({ ok: true, txt: "Uptrend - EMA20 > EMA50." }); }
    else { bear++; reasons.push({ ok: true, txt: "Downtrend - EMA20 < EMA50." }); }
  }
  if (ema200) { price > ema200 ? (bull++, reasons.push({ ok: true, txt: "Price above EMA200 - long-term bullish." })) : (bear++, reasons.push({ ok: true, txt: "Price below EMA200 - long-term bearish." })); }
  if (macd) { macd.hist > 0 ? (bull++, reasons.push({ ok: true, txt: "MACD positive - bullish momentum." })) : (bear++, reasons.push({ ok: true, txt: "MACD negative - bearish momentum." })); }
  if (rsi != null && rsi >= 30 && rsi <= 70) { rsi > 50 ? bull++ : bear++; reasons.push({ ok: true, txt: `RSI ${rsi.toFixed(0)} healthy (30-70).` }); }
  if (stoch != null) stoch > 50 ? bull += 0.5 : bear += 0.5;

  // --- Confluence bonus when votes strongly agree ---
  const voteGap = Math.abs(bull - bear);
  if (voteGap >= 3) score += 10;
  else if (voteGap >= 2) score += 5;

  // --- Direction chosen from the votes ---
  const direction = bull >= bear ? "CALL" : "PUT";
  const goingUp = direction === "CALL";

  // --- DIRECTION-AWARE CONTRADICTION CHECKS (the accuracy fix) ---
  let contradictions = 0;
  if (rsi != null) {
    if (rsi > 70) {
      if (goingUp) { score -= 18; contradictions++; reasons.push({ ok: false, txt: `RSI ${rsi.toFixed(0)} overbought - contradicts a RISE entry (pullback risk).` }); }
      else { score += 6; reasons.push({ ok: true, txt: `RSI ${rsi.toFixed(0)} overbought - supports a FALL entry.` }); }
    } else if (rsi < 30) {
      if (!goingUp) { score -= 18; contradictions++; reasons.push({ ok: false, txt: `RSI ${rsi.toFixed(0)} oversold - contradicts a FALL entry (bounce risk).` }); }
      else { score += 6; reasons.push({ ok: true, txt: `RSI ${rsi.toFixed(0)} oversold - supports a RISE entry.` }); }
    }
  }
  if (stoch != null) {
    if (stoch > 80 && goingUp) { score -= 12; contradictions++; reasons.push({ ok: false, txt: `Stochastic ${stoch.toFixed(0)} overbought - contradicts RISE.` }); }
    else if (stoch < 20 && !goingUp) { score -= 12; contradictions++; reasons.push({ ok: false, txt: `Stochastic ${stoch.toFixed(0)} oversold - contradicts FALL.` }); }
  }
  if (bb) {
    if (price > bb.upper && goingUp) { score -= 10; contradictions++; reasons.push({ ok: false, txt: "Price above upper Bollinger - stretched for a RISE." }); }
    else if (price < bb.lower && !goingUp) { score -= 10; contradictions++; reasons.push({ ok: false, txt: "Price below lower Bollinger - stretched for a FALL." }); }
  }

  // --- Higher timeframe alignment (direction-aware) ---
  if (higherTF && higherTF.length > 50) {
    const hc = higherTF.map(c => +c.close);
    const he20 = TA.ema(hc, 20), he50 = TA.ema(hc, 50);
    if (he20 && he50) {
      const htfBull = he20 > he50;
      const aligned = (htfBull && goingUp) || (!htfBull && !goingUp);
      htfAligned = aligned;
      if (aligned) { score += 12; reasons.push({ ok: true, txt: `Higher timeframe agrees (${htfBull ? "up" : "down"}) - stronger confluence.` }); }
      else { score -= 15; contradictions++; reasons.push({ ok: false, txt: "Higher timeframe conflicts with entry direction - mixed signals." }); }
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // --- Confidence = REAL conviction blend (not just vote ratio) ---
  const totalVotes = (bull + bear) || 1;
  const dominance = Math.min(1, voteGap / totalVotes);
  const scoreStrength = Math.max(0, Math.min(1, (score - 50) / 50));
  const cleanliness = Math.max(0, 1 - contradictions * 0.34);
  const htfBoost = htfAligned === true ? 1 : (htfAligned === false ? 0 : 0.5);

  let confidence = Math.round(
    (scoreStrength * 0.40 +
     cleanliness * 0.25 +
     dominance * 0.20 +
     htfBoost * 0.15) * 100
  );
  if (contradictions >= 1) confidence = Math.min(confidence, 60);
  if (contradictions >= 2) confidence = Math.min(confidence, 35);
  confidence = Math.max(0, Math.min(100, confidence));

  // --- Verdict gating: contradictions downgrade the label ---
  let color = safetyColor(score);
  let wait = false;
  if (contradictions >= 2) {
    wait = true;
    color = { key: "amber", label: "WAIT", css: "#ffb547" };
    reasons.push({ ok: false, txt: `${contradictions} indicators contradict this direction - WAIT for cleaner alignment.` });
  } else if (contradictions === 1 && color.label === "PRIME") {
    color = { key: "green", label: "SAFE", css: "#2fe38b" };
  }
  if (color.label === "PRIME" && confidence < 55) {
    color = { key: "green", label: "SAFE", css: "#2fe38b" };
  }

  const atrPct = (atr != null && price) ? (atr / price) * 100 : null;
  const volatilityWarning = atrPct != null
    ? { active: atrPct > 0.5, level: atrPct > 1.0 ? "extreme" : (atrPct > 0.5 ? "high" : "normal"), pct: atrPct }
    : { active: false, level: "unknown", pct: null };

  return { score, color, direction, confidence, contradictions, wait, reasons, digit: digitData, volatilityWarning,
    metrics: { rsi, atr, adx: adxO?.adx, macdHist: macd?.hist, stoch, ema20, ema50, ema200, bb, price } };
}
