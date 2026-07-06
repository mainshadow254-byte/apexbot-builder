// ApexBot AI Orb - Stage 1: draggable animated orb + panel shell
export function mountApexOrb() {
  const POS_KEY = "apex_orb_pos";

  function buildOrb() {
    if (document.getElementById("apexOrb")) return;

    // The orb
    const orb = document.createElement("div");
    orb.id = "apexOrb";
    orb.innerHTML = `<span class="apex-orb-ring"></span><span class="apex-orb-core">AI</span>`;
    document.body.appendChild(orb);

    // The panel shell (hidden by default)
    const panel = document.createElement("div");
    panel.id = "apexOrbPanel";
    panel.className = "hidden";
    panel.innerHTML = `
      <div class="apex-panel-head">
        <span class="apex-panel-dot"></span>
        <h3>AI Market Scanner</h3>
        <button id="apexPanelClose" aria-label="Close">x</button>
      </div>
      <div class="apex-panel-body">
        <p style="opacity:.7;padding:20px;text-align:center">Scanner controls load here (Stage 2).</p>
      </div>`;
    document.body.appendChild(panel);

    // Restore saved position
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    if (saved) { orb.style.left = saved.x + "px"; orb.style.top = saved.y + "px"; orb.style.right = "auto"; orb.style.bottom = "auto"; }
    if (parseInt(orb.style.top) < 140) { orb.style.top = "140px"; }

    // --- Dragging (mouse + touch), with click-vs-drag detection ---
    let dragging = false, moved = false, offX = 0, offY = 0;
    const start = (x, y) => {
      dragging = true; moved = false;
      const r = orb.getBoundingClientRect();
      offX = x - r.left; offY = y - r.top;
    };
    const move = (x, y) => {
      if (!dragging) return;
      moved = true;
      let nx = x - offX, ny = y - offY;
      nx = Math.max(0, Math.min(window.innerWidth - orb.offsetWidth, nx));
      ny = Math.max(140, Math.min(window.innerHeight - orb.offsetHeight, ny));
      orb.style.left = nx + "px"; orb.style.top = ny + "px";
      orb.style.right = "auto"; orb.style.bottom = "auto";
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        const r = orb.getBoundingClientRect();
        localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top }));
      } else {
        togglePanel(); // it was a tap, not a drag
      }
    };

    orb.addEventListener("mousedown", (e) => start(e.clientX, e.clientY));
    window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
    window.addEventListener("mouseup", end);
    orb.addEventListener("touchstart", (e) => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
    window.addEventListener("touchmove", (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
    window.addEventListener("touchend", end);

    function togglePanel() { panel.classList.toggle("hidden"); }
    document.getElementById("apexPanelClose").onclick = () => panel.classList.add("hidden");

    // Expose a tiny API for later stages
    window.ApexOrb = { open: () => panel.classList.remove("hidden"), close: () => panel.classList.add("hidden"), panelBody: () => panel.querySelector(".apex-panel-body") };
  }

  buildOrb();

  // ===== ORB STAGE 2: cascading selector =====
  function attachCascade() {
    const CATS = {
      synthetic_index: "Synthetics",
      forex: "Forex",
      commodities: "Commodities",
      cryptocurrency: "Cryptocurrency",
      indices: "Stock Indices",
    };
    const TRADE_TYPES = ["Rise / Fall", "Even / Odd", "Over / Under", "Matches / Differs"];

    function symbols() { return window.symbolsList || []; }

    function render() {
      const body = window.ApexOrb && window.ApexOrb.panelBody && window.ApexOrb.panelBody();
      if (!body) { setTimeout(render, 400); return; }
      if (body.querySelector(".orb-cascade")) return;

      const sel = { category: null, symbol: null, symbolName: null, tradeType: null, direction: null, digit: null, multi: false };
      window.ApexOrb.selection = sel;

      body.innerHTML = `
        <div class="orb-cascade">
          <div class="orb-crumb" id="orbCrumb">Pick a category to start...</div>
          <div class="orb-step" id="orbStepCat"><label>Category</label><div class="orb-btns" id="orbCats"></div></div>
          <div class="orb-step hidden" id="orbStepMkt"><label>Market</label><div class="orb-btns" id="orbMkts"></div></div>
          <div class="orb-step hidden" id="orbStepType"><label>Trade type</label><div class="orb-btns" id="orbTypes"></div></div>
          <div class="orb-step hidden" id="orbStepDir"><label>Direction</label><div class="orb-btns" id="orbDirs"></div></div>
          <div class="orb-multi">
            <label class="orb-switch"><input type="checkbox" id="orbMulti"><span>Multi-Market Scan</span></label>
            <small id="orbMultiHint"></small>
          </div>
          <button class="orb-scan" id="orbScan" disabled>Scan Markets</button>
          <div class="orb-result hidden" id="orbResult"></div>
        </div>`;

      const $ = (id) => body.querySelector("#" + id);
      const mkBtn = (label, active) => `<button class="orb-b${active ? " active" : ""}" data-v="${label}">${label}</button>`;

      function crumb() {
        const parts = [sel.category && CATS[sel.category], sel.symbolName, sel.tradeType,
          sel.direction ? (sel.digit != null ? `${sel.direction} ${sel.digit}` : sel.direction) : null].filter(Boolean);
        $("orbCrumb").textContent = parts.length ? parts.join(" > ") : "Pick a category to start...";
      }
      function refreshScan() {
        $("orbScan").disabled = !(sel.symbol && sel.tradeType && sel.direction);
      }

      $("orbCats").innerHTML = Object.entries(CATS).map(([k, v]) => `<button class="orb-b" data-k="${k}">${v}</button>`).join("");
      $("orbCats").querySelectorAll("button").forEach(b => b.onclick = () => {
        $("orbCats").querySelectorAll("button").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        sel.category = b.dataset.k; sel.symbol = sel.symbolName = sel.tradeType = sel.direction = null; sel.digit = null;

        const list = symbols().filter(s => s.market === b.dataset.k && s.exchange_is_open !== 0);
        $("orbMkts").innerHTML = list.length
          ? list.map(s => `<button class="orb-b" data-sym="${s.symbol}">${s.display_name}</button>`).join("")
          : `<small style="opacity:.6">No open markets in this category right now.</small>`;
        $("orbMkts").querySelectorAll("button").forEach(mb => mb.onclick = () => {
          $("orbMkts").querySelectorAll("button").forEach(x => x.classList.remove("active"));
          mb.classList.add("active");
          sel.symbol = mb.dataset.sym; sel.symbolName = mb.textContent;
          $("orbStepType").classList.remove("hidden");
          crumb(); refreshScan();
        });

        $("orbStepMkt").classList.remove("hidden");
        $("orbStepType").classList.add("hidden");
        $("orbStepDir").classList.add("hidden");
        crumb(); refreshScan();
      });

      $("orbTypes").innerHTML = TRADE_TYPES.map(t => mkBtn(t)).join("");
      $("orbTypes").querySelectorAll("button").forEach(b => b.onclick = () => {
        $("orbTypes").querySelectorAll("button").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        sel.tradeType = b.dataset.v; sel.direction = null; sel.digit = null;

        let dirs = "";
        if (sel.tradeType === "Rise / Fall") dirs = mkBtn("RISE") + mkBtn("FALL");
        else if (sel.tradeType === "Even / Odd") dirs = mkBtn("EVEN") + mkBtn("ODD");
        else if (sel.tradeType === "Over / Under") dirs = digitRow() + mkBtn("OVER") + mkBtn("UNDER");
        else if (sel.tradeType === "Matches / Differs") dirs = digitRow() + mkBtn("MATCHES") + mkBtn("DIFFERS");
        $("orbDirs").innerHTML = dirs;
        wireDirs();
        $("orbStepDir").classList.remove("hidden");
        crumb(); refreshScan();
      });

      function digitRow() {
        return `<div class="orb-digits">` +
          Array.from({ length: 10 }, (_, d) => `<button class="orb-d" data-digit="${d}">${d}</button>`).join("") +
          `</div>`;
      }
      function wireDirs() {
        $("orbDirs").querySelectorAll(".orb-d").forEach(d => d.onclick = () => {
          $("orbDirs").querySelectorAll(".orb-d").forEach(x => x.classList.remove("active"));
          d.classList.add("active"); sel.digit = +d.dataset.digit; crumb(); refreshScan();
        });
        $("orbDirs").querySelectorAll(".orb-b").forEach(b => b.onclick = () => {
          $("orbDirs").querySelectorAll(".orb-b").forEach(x => x.classList.remove("active"));
          b.classList.add("active"); sel.direction = b.dataset.v; crumb(); refreshScan();
        });
      }

      $("orbMulti").onchange = (e) => {
        sel.multi = e.target.checked;
        $("orbMultiHint").textContent = sel.multi
          ? "Will scan ALL open markets in this category for the best entry."
          : "";
      };

      // Scan + AI assurance (Stage 3)
      $("orbScan").onclick = async () => {
        const result = $("orbResult");
        const scanBtn = $("orbScan");
        const threshold = +(document.getElementById("minSafe")?.value || 60);
        scanBtn.disabled = true;
        result.classList.remove("hidden");

        function verdictCard(v, symName, isBest) {
          const safe = v.score >= threshold;
          const dir = v.direction === "CALL" ? "RISE" : "FALL";
          const m = v.metrics || {};
          let align = "";
          if (sel.tradeType === "Rise / Fall" && sel.direction) {
            const agree = (sel.direction === "RISE" && v.direction === "CALL") ||
                          (sel.direction === "FALL" && v.direction === "PUT");
            align = `<div class="orb-align ${agree ? "ok" : "no"}">${agree
              ? "AI agrees with your " + sel.direction
              : "AI signal is " + dir + ", opposite your " + sel.direction}</div>`;
          }

          return `
            <div class="orb-vcard ${isBest ? "best" : ""}">
              ${isBest ? '<div class="orb-badge">BEST ENTRY</div>' : ""}
              <div class="orb-vhead">
                <span class="orb-vname">${symName}</span>
                <span class="orb-vscore" style="color:${v.color.css}">${v.score}</span>
              </div>
              <div class="orb-vrow">
                <span class="orb-pill" style="background:${v.color.css}22;color:${v.color.css}">${v.color.label}</span>
                <span class="orb-assure ${safe ? "safe" : "risky"}">${safe ? "SAFE ENTRY" : "RISKY"}</span>
              </div>
              <div class="orb-vdir">AI signal: <b>${dir}</b> - Confidence ${v.confidence}</div>
              ${align}
              ${v.volatilityWarning?.active ? `<div class="orb-vol">Volatility ${v.volatilityWarning.level} (ATR ${v.volatilityWarning.pct.toFixed(2)}%)</div>` : ""}
              <div class="orb-vmetrics">
                <span>RSI ${m.rsi?.toFixed(0) ?? "-"}</span>
                <span>ADX ${m.adx?.toFixed(0) ?? "-"}</span>
                <span>MACD ${m.macdHist > 0 ? "+" : ""}${m.macdHist?.toFixed(4) ?? "-"}</span>
                <span>Stoch ${m.stoch?.toFixed(0) ?? "-"}</span>
              </div>
              ${v.digit ? `<div class="orb-digit">${v.digit.reason || ""}</div>` : ""}
            </div>`;
        }

        function proceedBar(best) {
          const safe = best.v.score >= threshold;
          return `<button class="orb-proceed ${safe ? "" : "warn"}" id="orbProceed">${safe
            ? "Load bot for " + best.name + " (opens Bot Builder)"
            : "Proceed anyway (risky) - load bot"}</button>`;
        }

        function wireProceed(best) {
          const p = result.querySelector("#orbProceed");
          if (p) p.onclick = async () => {
            window.ApexOrb.lastVerdict = best;
            p.disabled = true;
            p.textContent = "Loading bot for " + best.name + "...";
            try {
              const r = await window.apexLoadAndRun?.(best.symbol);
              if (r && r.ok) {
                p.textContent = "Loaded in Bot Builder - set your stake & press Run";
              } else {
                p.textContent = "Could not load (" + ((r && r.reason) || "unknown") + ") - tap to retry";
                p.disabled = false;
              }
            } catch (e) {
              p.textContent = "Error loading bot - tap to retry";
              p.disabled = false;
            }
          };
        }

        try {
          if (sel.multi) {
            const markets = symbols().filter(s => s.market === sel.category && s.exchange_is_open !== 0).slice(0, 20);
            const scored = [];
            for (let i = 0; i < markets.length; i++) {
              result.innerHTML = `<div class="orb-progress">Scanning ${i + 1}/${markets.length}... <b>${markets[i].display_name}</b></div>`;
              try {
                const v = await window.apexScan(markets[i].symbol);
                scored.push({ symbol: markets[i].symbol, name: markets[i].display_name, v });
              } catch (e) {}
              await new Promise(r => setTimeout(r, 120));
            }
            scored.sort((a, b) => b.v.score - a.v.score);
            if (!scored.length) {
              result.innerHTML = `<div class="orb-progress">No markets could be scanned right now.</div>`;
            } else {
              window.ApexOrb.lastVerdict = scored[0];
              result.innerHTML = `<div class="orb-rtitle">Best of ${scored.length} scanned</div>` +
                scored.slice(0, 5).map((s, i) => verdictCard(s.v, s.name, i === 0)).join("") +
                proceedBar(scored[0]);
              wireProceed(scored[0]);
            }
          } else {
            result.innerHTML = `<div class="orb-progress">Scanning ${sel.symbolName}...</div>`;
            const v = await window.apexScan(sel.symbol);
            const safe = v.score >= threshold;
            let html = `<div class="orb-rtitle">Scan result</div>` + verdictCard(v, sel.symbolName, false);
            const chosen = { symbol: sel.symbol, name: sel.symbolName, v };

            if (!safe) {
              const alts = symbols().filter(s => s.market === sel.category && s.exchange_is_open !== 0 && s.symbol !== sel.symbol).slice(0, 8);
              const scored = [];
              for (let i = 0; i < alts.length; i++) {
                result.innerHTML = html + `<div class="orb-progress">Chosen market looks risky - checking alternatives ${i + 1}/${alts.length}...</div>`;
                try {
                  const av = await window.apexScan(alts[i].symbol);
                  scored.push({ symbol: alts[i].symbol, name: alts[i].display_name, v: av });
                } catch (e) {}
                await new Promise(r => setTimeout(r, 120));
              }
              scored.sort((a, b) => b.v.score - a.v.score);
              const best = scored.find(s => s.v.score >= threshold) || scored[0];
              if (best) {
                html += `<div class="orb-rtitle">Safer alternative</div>` + verdictCard(best.v, best.name, true) +
                  `<button class="orb-usealt" data-sym="${best.symbol}" data-name="${best.name}">Switch to ${best.name}</button>`;
              }
            }

            window.ApexOrb.lastVerdict = chosen;
            result.innerHTML = html + proceedBar(chosen);
            const altBtn = result.querySelector(".orb-usealt");
            if (altBtn) altBtn.onclick = () => {
              sel.symbol = altBtn.dataset.sym; sel.symbolName = altBtn.dataset.name;
              window.selectSymbolFromOrb?.(sel.symbol);
              crumb(); scanBtn.disabled = false; scanBtn.click();
            };
            wireProceed(chosen);
          }
        } catch (e) {
          result.innerHTML = `<div class="orb-progress">Scan failed: ${e?.message || "unknown error"}</div>`;
        } finally {
          scanBtn.disabled = false;
        }
      };

      crumb();
    }

    render();
  }
  attachCascade();
}
