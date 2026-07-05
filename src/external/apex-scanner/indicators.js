export const TA = {
  sma(v, p) { if (v.length < p) return null; return v.slice(-p).reduce((a, b) => a + b, 0) / p; },

  emaSeries(v, p) {
    if (v.length < p) return [];
    const k = 2 / (p + 1), out = [];
    let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p; out[p - 1] = e;
    for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
    return out;
  },

  ema(v, p) { const s = this.emaSeries(v, p); return s.length ? s[s.length - 1] : null; },

  rsi(c, p = 14) {
    if (c.length < p + 1) return null;
    let g = 0, l = 0;
    for (let i = c.length - p; i < c.length; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; }
    const rs = l === 0 ? 100 : g / l; return 100 - 100 / (1 + rs);
  },

  atr(h, l, c, p = 14) {
    if (c.length < p + 1) return null;
    const tr = [];
    for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    return this.sma(tr, p);
  },

  adx(h, l, c, p = 14) {
    if (c.length < p * 2) return null;
    const pDM = [], mDM = [], tr = [];
    for (let i = 1; i < c.length; i++) {
      const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
      pDM.push(up > dn && up > 0 ? up : 0); mDM.push(dn > up && dn > 0 ? dn : 0);
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    }
    const atr = this.sma(tr, p); if (!atr) return null;
    const pDI = 100 * this.sma(pDM, p) / atr, mDI = 100 * this.sma(mDM, p) / atr;
    return { adx: 100 * Math.abs(pDI - mDI) / ((pDI + mDI) || 1), plusDI: pDI, minusDI: mDI };
  },

  macd(c, f = 12, s = 26, sig = 9) {
    if (c.length < s + sig) return null;
    const ef = this.emaSeries(c, f), es = this.emaSeries(c, s), line = [];
    for (let i = 0; i < c.length; i++) if (ef[i] != null && es[i] != null) line[i] = ef[i] - es[i];
    const comp = line.filter(x => x != null), cur = comp[comp.length - 1], sigVal = this.ema(comp, sig);
    return { macd: cur, signal: sigVal, hist: cur - sigVal };
  },

  bollinger(c, p = 20, m = 2) {
    if (c.length < p) return null;
    const mid = this.sma(c, p), sl = c.slice(-p);
    const sd = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / p);
    return { upper: mid + m * sd, mid, lower: mid - m * sd, width: (2 * m * sd) / mid };
  },

  stochastic(h, l, c, p = 14) {
    if (c.length < p) return null;
    const hh = Math.max(...h.slice(-p)), ll = Math.min(...l.slice(-p));
    return ((c[c.length - 1] - ll) / ((hh - ll) || 1)) * 100;
  },
};
