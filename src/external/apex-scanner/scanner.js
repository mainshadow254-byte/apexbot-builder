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
  const digits = ticks.map(t => { const s = String(t); return +s[s.length - 1]; });
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
  let score = 50; const reasons = []; let bull = 0, bear = 0;

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
      if (aligned) { score += 12; reasons.push({ ok: true, txt: `Higher timeframe agrees (${htfBull ? "up" : "down"}) - stronger confluence.` }); }
      else { score -= 15; contradictions++; reasons.push({ ok: false, txt: "Higher timeframe conflicts with entry direction - mixed signals." }); }
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // --- Confidence: vote separation, penalized by contradictions ---
  let confidence = Math.round((voteGap / ((bull + bear) || 1)) * 100);
  confidence = Math.max(0, confidence - contradictions * 20);

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
