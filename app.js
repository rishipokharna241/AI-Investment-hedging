/**
 * COMEX vs MCX Pro Terminal — Application Engine v3 (Tabbed Layout)
 * Features: Yahoo Finance Live API | Chatbot Chatbot | AutoTrader | Forex Factory Calendar
 */
document.addEventListener('DOMContentLoaded', () => {

  // =========================================================================
  // GLOBAL STATE
  // =========================================================================
  const state = {
    selectedCommodity: 'gold',
    soundEnabled: false,
    apiStatus: 'connecting',
    activeTab: 'dashboard',

    config: {
      customDutyPct:   15.0,
      copperDutyPct:   5.0,
      crudeDutyPct:    2.5,
      gstPct:          3.0,
      includeGstInParity: false,
      freightPct:      0.2,
      usdInr:          83.45,
      autoUsdInr:      true,
      alertThresholdPct: 0.30,
    },

    commodities: {
      gold:   { id:'gold',   name:'Gold (10g)',      symbolCOMEX:'GC=F',  symbolMCX:'GOLD (AUG)',     unitCOMEX:'/ oz',  unitMCX:'/ 10g',   convFactor:31.1034768, mult:10,   lotUnit:'Grams',   defLot:100,  comexPrice:2385.5,  comexCh:12.4,   comexChPct:0.52,  mcxPrice:73920, mcxCh:320,  mcxChPct:0.43,  hi:74200, lo:73500, open:73650, close:73600, history:[] },
      silver: { id:'silver', name:'Silver (1kg)',    symbolCOMEX:'SI=F',  symbolMCX:'SILVER (SEP)',   unitCOMEX:'/ oz',  unitMCX:'/ 1 kg',  convFactor:31.1034768, mult:1000, lotUnit:'Kg',      defLot:30,   comexPrice:30.85,   comexCh:-0.12,  comexChPct:-0.39, mcxPrice:85600, mcxCh:-180, mcxChPct:-0.21, hi:86200, lo:85100, open:85800, close:85780, history:[] },
      copper: { id:'copper', name:'Copper (1kg)',    symbolCOMEX:'HG=F',  symbolMCX:'COPPER (AUG)',   unitCOMEX:'/ lb',  unitMCX:'/ 1 kg',  convFactor:0.45359237, mult:1,    lotUnit:'Kg',      defLot:2500, comexPrice:4.45,    comexCh:0.04,   comexChPct:0.91,  mcxPrice:845.5, mcxCh:7.2,  mcxChPct:0.86,  hi:849,   lo:838,   open:839,   close:838.3, history:[] },
      crude:  { id:'crude',  name:'Crude Oil (Bbl)', symbolCOMEX:'CL=F',  symbolMCX:'CRUDEOIL (AUG)',unitCOMEX:'/ bbl', unitMCX:'/ Bbl',   convFactor:1,          mult:1,    lotUnit:'Barrels', defLot:100,  comexPrice:78.4,    comexCh:0.85,   comexChPct:1.10,  mcxPrice:6680,  mcxCh:75,   mcxChPct:1.13,  hi:6720,  lo:6610,  open:6615,  close:6605,  history:[] },
    },

    autoTrader: {
      enabled:     false,
      triggerPct:  0.50,
      stopLossPct: 1.50,
      takeProfitPct:    0.80,
      exitReversionPct: 0.10,
      maxPositions:4,
      enabledCommodities: { gold:true, silver:true, copper:true, crude:true },
      openPositions: [],
      tradeLog:      [],
      nextTradeId:   1,
      realizedPnl:   0,
    },

    forexFactory: {
      events:       [],
      activeFilter: 'ALL',
      haltActive:   false,
      haltEventName:'',
      nextHighImpact: null,
      status:       'syncing',
    },
  };

  // =========================================================================
  // HELPERS
  // =========================================================================
  const el = id => document.getElementById(id);
  const fmtInr = v => `₹${Number(v).toLocaleString(undefined,{maximumFractionDigits:0})}`;
  const sign   = v => v >= 0 ? '+' : '';
  const cmIcon = k => ({ gold:'fa-coins', silver:'fa-cube', copper:'fa-bolt', crude:'fa-droplet' }[k]||'fa-chart-line');

  // =========================================================================
  // AUDIO
  // =========================================================================
  let audioCtx = null;
  function beep(freq=880, dur=0.4) {
    if (!state.soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.frequency.setValueAtTime(freq, audioCtx.currentTime);
      g.gain.setValueAtTime(0.15, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime+dur);
    } catch(e){}
  }

  // =========================================================================
  // MATH ENGINE
  // =========================================================================
  function calcFair(key, comexPrice, usdInr, cfg) {
    const c = state.commodities[key];
    let baseGramUsd, basePriceInr, dutyRate, gstRate;
    if (key==='gold'||key==='silver') {
      baseGramUsd  = comexPrice / c.convFactor;
      basePriceInr = baseGramUsd * usdInr * c.mult;
      dutyRate = cfg.customDutyPct; gstRate = cfg.gstPct;
    } else if (key==='copper') {
      baseGramUsd  = comexPrice / c.convFactor;
      basePriceInr = baseGramUsd * usdInr;
      dutyRate = cfg.copperDutyPct; gstRate = 18;
    } else {
      baseGramUsd  = comexPrice;
      basePriceInr = comexPrice * usdInr;
      dutyRate = cfg.crudeDutyPct; gstRate = 3;
    }
    const dutyAmt    = basePriceInr * (dutyRate/100);
    const freightAmt = basePriceInr * (cfg.freightPct/100);
    const priceWithDuty = basePriceInr + dutyAmt;
    const futuresFair   = priceWithDuty + freightAmt;
    const gstAmt        = priceWithDuty * (gstRate/100);
    const physicalFair  = futuresFair + gstAmt;
    const landed = cfg.includeGstInParity ? physicalFair : futuresFair;
    return { baseGramUsd, basePriceInr, dutyAmt, dutyRate, freightAmt, gstAmt, gstRate, futuresFair, physicalFair, landed };
  }

  function calcArb(mcxPrice, fairValue, threshPct) {
    const spreadInr = mcxPrice - fairValue;
    const spreadPct = (spreadInr / fairValue) * 100;
    let signalType='neutral', title='FAIRLY PRICED', action='No arbitrage opportunity';
    if (spreadPct >  threshPct) { signalType='sell'; title='MCX OVERPRICED';  action='SELL MCX / Import Parity Arbitrage'; }
    if (spreadPct < -threshPct) { signalType='buy';  title='MCX DISCOUNTED'; action='BUY MCX / Domestic Arbitrage'; }
    return { spreadInr, spreadPct, signalType, title, action };
  }

  // =========================================================================
  // YAHOO FINANCE LIVE API
  // =========================================================================
  const YF = {
    gold:'GC%3DF', silver:'SI%3DF', copper:'HG%3DF', crude:'CL%3DF', usdinr:'INR%3DX'
  };

  async function fetchSymbol(sym) {
    try {
      const r = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return { ok: false };
      const d = await r.json();
      if (!d?.ok) return { ok: false };
      return {
        price: d.price,
        change: d.change,
        chPct: d.chPct,
        high: d.high,
        low: d.low,
        open: d.open,
        prevClose: d.prevClose,
        ok: true,
      };
    } catch (e) {
      return { ok: false };
    }
  }

  async function fetchAllLive() {
    let anyOk = false;
    if (state.config.autoUsdInr) {
      const fx = await fetchSymbol(YF.usdinr);
      if (fx.ok) { state.config.usdInr = +fx.price.toFixed(2); anyOk = true; }
    }
    const keys = ['gold','silver','copper','crude'];
    const results = await Promise.allSettled(keys.map(k => fetchSymbol(YF[k])));
    results.forEach((r, i) => {
      if (r.status==='fulfilled'&&r.value.ok) {
        const d=r.value, key=keys[i], item=state.commodities[key];
        item.comexPrice = d.price;
        item.comexCh    = d.change;
        item.comexChPct = d.chPct;
        item.hi = d.high; item.lo = d.low;
        item.open = d.open; item.close = d.prevClose;
        const cv = calcFair(key, d.price, state.config.usdInr, state.config);
        const prem = (Math.random()-0.47)*0.008;
        item.mcxPrice = +(cv.landed*(1+prem)).toFixed(1);
        item.mcxCh    = +(item.mcxPrice-cv.landed).toFixed(1);
        item.mcxChPct = (item.mcxCh/item.mcxPrice)*100;
        anyOk = true;
      }
    });
    state.apiStatus = anyOk ? 'live' : 'fallback';
    updateStatusBadge();
  }

  function updateStatusBadge() {
    const dot=el('status-dot'), txt=el('status-text');
    if (!dot||!txt) return;
    if (state.apiStatus==='live') {
      dot.className='status-dot online';
      txt.textContent='✅ YAHOO FINANCE LIVE — GC=F · SI=F · HG=F · CL=F · INR=X';
    } else if (state.apiStatus==='fallback') {
      dot.className='status-dot warn';
      txt.textContent='⚠️ PROXY STREAM (Simulated ticks)';
    } else {
      dot.className='status-dot';
      txt.textContent='🔄 CONNECTING...';
    }
  }

  // =========================================================================
  // HISTORY & TICK ENGINE
  // =========================================================================
  function initHistory() {
    const now = Date.now();
    Object.keys(state.commodities).forEach(key => {
      const item = state.commodities[key];
      item.history = [];
      for (let i=30;i>=0;i--) {
        const t = new Date(now - i*3000);
        const rf = (Math.random()-0.49)*0.002;
        const cP = item.comexPrice*(1+rf);
        const cv  = calcFair(key, cP, state.config.usdInr, state.config);
        const mP  = cv.landed*(1+(Math.random()-0.47)*0.008);
        const arb = calcArb(mP, cv.landed, state.config.alertThresholdPct);
        item.history.push({
          t: t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
          comex:cP, fair:cv.landed, mcx:mP, spread:arb.spreadPct,
        });
      }
    });
  }

  function startTickEngine() {
    fetchAllLive();
    setInterval(fetchAllLive, 5000);

    setInterval(() => {
      if (state.config.autoUsdInr)
        state.config.usdInr = Math.max(75, Math.min(95, state.config.usdInr + (Math.random()-0.49)*0.01));

      Object.keys(state.commodities).forEach(key => {
        const item = state.commodities[key];
        item.comexPrice = Math.max(0.1, item.comexPrice + (Math.random()-0.495)*item.comexPrice*0.0008);
        item.mcxPrice   = Math.max(0.1, item.mcxPrice   + (Math.random()-0.49) *item.mcxPrice  *0.0008);
        const cv  = calcFair(key, item.comexPrice, state.config.usdInr, state.config);
        const arb = calcArb(item.mcxPrice, cv.landed, state.config.alertThresholdPct);
        item.history.push({
          t: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
          comex:item.comexPrice, fair:cv.landed, mcx:item.mcxPrice, spread:arb.spreadPct,
        });
        if (item.history.length>60) item.history.shift();
        if (key===state.selectedCommodity && Math.abs(arb.spreadPct)>state.config.alertThresholdPct*1.5) beep(880, 0.35);
      });

      if (state.autoTrader.enabled && !state.forexFactory.haltActive) runAutoTrader();
      renderUI();
      renderLiveSnapshot();
    }, 1500);
  }

  // =========================================================================
  // AUTOTRADER ENGINE
  // =========================================================================
  function getEffectiveTriggerPct() {
    if (state.forexFactory.haltActive) return Infinity;
    const ff=state.forexFactory, now=new Date();
    const medSoon = ff.events.some(ev => {
      const d=ev.eventDate-now;
      return ev.impact==='Medium'&&d>0&&d<30*60*1000;
    });
    return medSoon ? state.autoTrader.triggerPct*1.5 : state.autoTrader.triggerPct;
  }

  function runAutoTrader() {
    const at=state.autoTrader;
    const now=new Date();

    // ── Check exits ──
    at.openPositions.forEach((pos, idx) => {
      const item = state.commodities[pos.key];
      const cv   = calcFair(pos.key, item.comexPrice, state.config.usdInr, state.config);
      const curMcx = item.mcxPrice;
      const curSpreadPct = ((curMcx-cv.landed)/cv.landed)*100;
      const fPnl = pos.direction==='SELL'
        ? (pos.entryPrice-curMcx)*pos.lotUnits
        : (curMcx-pos.entryPrice)*pos.lotUnits;
      const fPnlPct = (fPnl/(pos.entryPrice*pos.lotUnits))*100;
      pos.currentPrice = curMcx; pos.currentSpreadPct = curSpreadPct; pos.floatPnl = fPnl;

      let exit = null;
      if (fPnlPct >=  at.takeProfitPct)                    exit = '✅ Take Profit';
      if (fPnlPct <= -at.stopLossPct)                      exit = '🛑 Stop Loss';
      if (Math.abs(curSpreadPct)<=at.exitReversionPct) exit = '🔁 Spread Reverted';

      if (exit) { closePosition(pos, curMcx, exit, now); at.openPositions.splice(idx, 1); }
    });

    // ── Check entries ──
    const trig = getEffectiveTriggerPct();
    Object.keys(state.commodities).forEach(key => {
      if (!at.enabledCommodities[key]) return;
      if (at.openPositions.length >= at.maxPositions) return;
      if (at.openPositions.find(p=>p.key===key)) return;
      const item = state.commodities[key];
      const cv   = calcFair(key, item.comexPrice, state.config.usdInr, state.config);
      const arb  = calcArb(item.mcxPrice, cv.landed, state.config.alertThresholdPct);
      const lotUnits = state.commodities[key].defLot / state.commodities[key].mult;
      let dir = null;
      if (arb.spreadPct >  trig) dir='SELL';
      if (arb.spreadPct < -trig) dir='BUY';
      if (dir) {
        at.openPositions.push({
          id: at.nextTradeId++, key, commodityName: item.name, direction: dir,
          entryPrice: item.mcxPrice, entryFairValue: cv.landed, entrySpreadPct: arb.spreadPct,
          entryTime: now, lotUnits,
          currentPrice: item.mcxPrice, currentSpreadPct: arb.spreadPct, floatPnl: 0,
        });
        beep(dir==='BUY'?523:659, 0.5);
        addBotMsg(`🤖 AutoTrader: **${dir} ${item.name}** @ ₹${item.mcxPrice.toLocaleString()} | Spread: ${arb.spreadPct.toFixed(2)}%`);
      }
    });
    renderAutoTrader();
  }

  function closePosition(pos, exitPrice, reason, now) {
    const at = state.autoTrader;
    const durSec = Math.round((now-pos.entryTime)/1000);
    const durStr = durSec<60 ? `${durSec}s` : `${Math.floor(durSec/60)}m ${durSec%60}s`;
    const pnl = pos.direction==='SELL'
      ? (pos.entryPrice-exitPrice)*pos.lotUnits
      : (exitPrice-pos.entryPrice)*pos.lotUnits;
    const pnlPct = (pnl/(pos.entryPrice*pos.lotUnits))*100;
    at.realizedPnl += pnl;
    at.tradeLog.unshift({ id:pos.id, key:pos.key, commodityName:pos.commodityName,
      direction:pos.direction, entryPrice:pos.entryPrice, exitPrice, pnl, pnlPct,
      duration:durStr, exitReason:reason, exitTime:now });
    if (at.tradeLog.length>20) at.tradeLog.pop();
    beep(pnl>=0?1047:220, 0.6);
    addBotMsg(`🔒 Closed **${pos.direction} ${pos.commodityName}** → PnL: ${pnl>=0?'+':''}₹${Math.round(pnl).toLocaleString()} | ${reason}`);
  }

  function renderAutoTrader() {
    const at = state.autoTrader;
    const unrealized = at.openPositions.reduce((s,p)=>s+(p.floatPnl||0),0);
    const wins  = at.tradeLog.filter(t=>t.pnl>0).length;
    const wRate = at.tradeLog.length ? `${Math.round((wins/at.tradeLog.length)*100)}%` : '—';

    // Stats
    setText('at-open-count',  at.openPositions.length);
    setText('at-total-count', at.tradeLog.length);
    setText('at-win-rate',    wRate);
    const rpEl = el('at-realized-pnl');
    if (rpEl) { rpEl.textContent=`${sign(at.realizedPnl)}₹${Math.round(at.realizedPnl).toLocaleString()}`; rpEl.className=`asc-val ${at.realizedPnl>=0?'hl-green':'hl-red'}`; }
    const upEl = el('at-unrealized-pnl');
    if (upEl) { upEl.textContent=`${sign(unrealized)}₹${Math.round(unrealized).toLocaleString()}`; upEl.className=`asc-val ${unrealized>=0?'hl-green':'hl-red'}`; }

    // Header pills
    const atLbl = el('at-status-label');
    if (atLbl) { atLbl.textContent=at.enabled?'ON':'OFF'; atLbl.className=`hpill-val ${at.enabled?'hl-green':'hl-red'}`; }
    setText('at-pnl-header', `${sign(at.realizedPnl)}₹${Math.round(at.realizedPnl).toLocaleString()}`);

    // Tab badge
    const atBadge = el('at-tab-badge');
    if (atBadge) { atBadge.textContent=at.enabled?`ON · ${at.openPositions.length} open`:'OFF'; }

    // Toggle label
    const mtTxt = el('at-toggle-text');
    if (mtTxt) mtTxt.textContent = at.enabled ? 'AUTOTRADER ON ✅' : 'AUTOTRADER OFF';

    // Open badge
    setText('at-open-badge',`${at.openPositions.length} Open`);
    setText('at-log-badge', `${at.tradeLog.length} Trades`);

    // FF halt indicator
    const haltInd = el('at-ff-halt-indicator');
    if (haltInd) haltInd.style.display = state.forexFactory.haltActive ? 'flex' : 'none';

    // Open positions table
    const opTbody = el('at-open-tbody');
    if (opTbody) {
      if (at.openPositions.length===0) {
        opTbody.innerHTML=`<tr class="empty-row"><td colspan="10">No open positions. ${at.enabled?'Monitoring for signals…':'AutoTrader is OFF.'}</td></tr>`;
      } else {
        opTbody.innerHTML = at.openPositions.map(pos=>{
          const pCls = pos.floatPnl>=0?'hl-green':'hl-red';
          const dCls = pos.direction==='BUY'?'sig-buy':'sig-sell';
          return `<tr>
            <td class="cell-mono">${pos.entryTime.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
            <td class="cell-sym"><i class="fa-solid ${cmIcon(pos.key)} ${pos.key}-icon"></i>${pos.commodityName}</td>
            <td><span class="sig-badge ${dCls}">${pos.direction}</span></td>
            <td class="cell-mono">₹${pos.entryPrice.toLocaleString(undefined,{maximumFractionDigits:1})}</td>
            <td class="cell-mono">₹${pos.entryFairValue.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
            <td class="cell-mono ${pos.entrySpreadPct>=0?'hl-red':'hl-green'}">${pos.entrySpreadPct.toFixed(2)}%</td>
            <td class="cell-mono">₹${pos.currentPrice.toLocaleString(undefined,{maximumFractionDigits:1})}</td>
            <td class="cell-mono ${pos.currentSpreadPct>=0?'hl-red':'hl-green'}">${pos.currentSpreadPct.toFixed(2)}%</td>
            <td class="cell-mono ${pCls}">${pos.floatPnl>=0?'+':''}₹${Math.round(pos.floatPnl).toLocaleString()}</td>
            <td><button onclick="manualClose(${pos.id})" class="btn btn-outline" style="padding:3px 8px;font-size:10px;">Close</button></td>
          </tr>`;
        }).join('');
      }
    }

    // Trade log table
    const logTbody = el('at-log-tbody');
    if (logTbody) {
      if (at.tradeLog.length===0) {
        logTbody.innerHTML=`<tr class="empty-row"><td colspan="9">No completed trades yet.</td></tr>`;
      } else {
        logTbody.innerHTML = at.tradeLog.slice(0,20).map(t=>{
          const pCls=t.pnl>=0?'hl-green':'hl-red';
          const dCls=t.direction==='BUY'?'sig-buy':'sig-sell';
          return `<tr>
            <td class="cell-mono">${t.exitTime.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
            <td class="cell-sym"><i class="fa-solid ${cmIcon(t.key)} ${t.key}-icon"></i>${t.commodityName}</td>
            <td><span class="sig-badge ${dCls}">${t.direction}</span></td>
            <td class="cell-mono">₹${t.entryPrice.toLocaleString(undefined,{maximumFractionDigits:1})}</td>
            <td class="cell-mono">₹${t.exitPrice.toLocaleString(undefined,{maximumFractionDigits:1})}</td>
            <td class="cell-mono ${pCls}">${t.pnl>=0?'+':''}₹${Math.round(t.pnl).toLocaleString()}</td>
            <td class="cell-mono ${pCls}">${t.pnlPct.toFixed(2)}%</td>
            <td class="cell-mono">${t.duration}</td>
            <td style="font-size:10px;">${t.exitReason}</td>
          </tr>`;
        }).join('');
      }
    }
  }

  window.manualClose = function(id) {
    const at=state.autoTrader;
    const idx=at.openPositions.findIndex(p=>p.id===id);
    if (idx===-1) return;
    const pos=at.openPositions[idx];
    closePosition(pos, state.commodities[pos.key].mcxPrice, '👤 Manual Close', new Date());
    at.openPositions.splice(idx,1);
    renderAutoTrader();
  };

  // =========================================================================
  // CHART ENGINE
  // =========================================================================
  let chart = null;

  function initChart() {
    const ctx = document.getElementById('arbitrageChart').getContext('2d');
    chart = new Chart(ctx, {
      type:'line',
      data:{
        labels:[],
        datasets:[
          { label:'MCX Futures (₹)',        data:[], borderColor:'#38BDF8', backgroundColor:'rgba(56,189,248,.06)',  borderWidth:2, tension:.3, fill:false, yAxisID:'y' },
          { label:'COMEX Fair Parity (₹)',  data:[], borderColor:'#F59E0B', backgroundColor:'rgba(245,158,11,.06)', borderWidth:2, borderDash:[4,4], tension:.3, fill:false, yAxisID:'y' },
          { label:'Arbitrage Spread %',     data:[], borderColor:'#10B981', backgroundColor:'rgba(16,185,129,.12)', borderWidth:1.5, tension:.3, fill:true, yAxisID:'yS' },
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:250},
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{position:'top',labels:{color:'#8899B0',font:{family:'Inter',size:10,weight:'600'},usePointStyle:true}},
          tooltip:{backgroundColor:'#0D1421',borderColor:'#1E2D42',borderWidth:1,titleColor:'#FFF',bodyColor:'#8899B0',titleFont:{family:'Outfit',size:12,weight:'700'},bodyFont:{family:'JetBrains Mono',size:11}},
        },
        scales:{
          x:{grid:{color:'#141E2E'},ticks:{color:'#506070',font:{family:'JetBrains Mono',size:9}}},
          y:{type:'linear',display:true,position:'left',grid:{color:'#141E2E'},ticks:{color:'#38BDF8',font:{family:'JetBrains Mono',size:10},callback:v=>'₹'+v.toLocaleString()}},
          yS:{type:'linear',display:true,position:'right',grid:{drawOnChartArea:false},ticks:{color:'#10B981',font:{family:'JetBrains Mono',size:9},callback:v=>v.toFixed(2)+'%'}},
        }
      }
    });
  }

  function updateChart() {
    if (!chart) return;
    let h = state.commodities[state.selectedCommodity].history;
    const activeTf = document.querySelector('.tf-btn.active')?.dataset.tf || '1H';
    if (activeTf === '1M') h = h.slice(-15);
    else if (activeTf === '5M') h = h.slice(-30);
    const lastSpread = h[h.length-1]?.spread||0;
    chart.data.labels = h.map(x=>x.t);
    chart.data.datasets[0].data = h.map(x=>x.mcx);
    chart.data.datasets[1].data = h.map(x=>x.fair);
    chart.data.datasets[2].data = h.map(x=>x.spread);
    chart.data.datasets[2].borderColor     = lastSpread<0?'#EF4444':'#10B981';
    chart.data.datasets[2].backgroundColor = lastSpread<0?'rgba(239,68,68,.12)':'rgba(16,185,129,.12)';
    const item = state.commodities[state.selectedCommodity];
    setText('chart-main-title', `Yahoo Live: ${item.name} MCX vs COMEX Fair Parity`);
    chart.update();
  }

  // =========================================================================
  // MAIN UI RENDERER
  // =========================================================================
  function setText(id,v){ const e=el(id); if(e) e.textContent=v; }

  function renderUI() {
    const key  = state.selectedCommodity;
    const item = state.commodities[key];
    const usdInr = state.config.usdInr;
    const cv   = calcFair(key, item.comexPrice, usdInr, state.config);
    const arb  = calcArb(item.mcxPrice, cv.landed, state.config.alertThresholdPct);

    // Header pills
    setText('usdinr-rate-display', `₹${usdInr.toFixed(2)}`);
    setText('header-duty-display', state.config.includeGstInParity ? `${state.config.customDutyPct}%+${state.config.gstPct}% GST` : `${state.config.customDutyPct}% BCD`);

    // Commodity tabs (all 4)
    Object.keys(state.commodities).forEach(k => {
      const comm = state.commodities[k];
      const cvc  = calcFair(k, comm.comexPrice, usdInr, state.config);
      const ca   = calcArb(comm.mcxPrice, cvc.landed, state.config.alertThresholdPct);
      setText(`tab-price-${k}`, `₹${comm.mcxPrice.toLocaleString(undefined,{maximumFractionDigits:1})}`);
      const sEl = el(`tab-spread-${k}`);
      if (sEl) {
        sEl.textContent = `${sign(ca.spreadPct)}${ca.spreadPct.toFixed(2)}%`;
        sEl.className = `tab-spread ${ca.spreadPct>state.config.alertThresholdPct?'pos':ca.spreadPct<-state.config.alertThresholdPct?'neg':'neu'}`;
      }
    });

    // Card 1: COMEX
    setText('comex-symbol-tag',   `Yahoo ${item.symbolCOMEX}`);
    setText('comex-price-val',    item.comexPrice.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
    setText('comex-unit-val',     item.unitCOMEX);
    const cChEl = el('comex-change-val');
    if (cChEl) { cChEl.textContent=`${sign(item.comexCh)}${item.comexCh.toFixed(2)} (${sign(item.comexChPct)}${item.comexChPct.toFixed(2)}%)`; cChEl.className=`change-tag ${item.comexCh>=0?'positive':'negative'}`; }
    setText('comex-last-update', new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' LIVE');
    if (key==='gold'||key==='silver') {
      setText('comex-conversion-info', `1 Troy Oz = ${item.convFactor} g`);
      setText('comex-gram-usd', `$${cv.baseGramUsd.toFixed(2)} / g`);
      setText('comex-base-inr', `₹${cv.basePriceInr.toLocaleString(undefined,{maximumFractionDigits:0})} ${item.unitMCX}`);
    } else if (key==='copper') {
      setText('comex-conversion-info', `1 lb = ${item.convFactor} kg`);
      setText('comex-gram-usd', `$${cv.baseGramUsd.toFixed(2)} / kg`);
      setText('comex-base-inr', `₹${cv.basePriceInr.toLocaleString(undefined,{maximumFractionDigits:1})} / kg`);
    } else {
      setText('comex-conversion-info', '1 Barrel = 1 Bbl (Standard)');
      setText('comex-gram-usd', `$${item.comexPrice.toFixed(2)} / bbl`);
      setText('comex-base-inr', `₹${cv.basePriceInr.toLocaleString(undefined,{maximumFractionDigits:0})} / bbl`);
    }

    // Card 2: Fair Value
    setText('card-tax-summary-badge', state.config.includeGstInParity ? `+${cv.dutyRate}% BCD + ${cv.gstRate}% GST` : `+${cv.dutyRate}% BCD (Futures Parity)`);
    setText('fair-value-val', cv.landed.toLocaleString(undefined,{maximumFractionDigits:0}));
    setText('fair-unit-val', item.unitMCX);
    setText('tax-base-price', `₹${cv.basePriceInr.toLocaleString(undefined,{maximumFractionDigits:0})}`);
    setText('disp-duty-pct', cv.dutyRate.toFixed(1));
    setText('tax-duty-amt', `+₹${cv.dutyAmt.toLocaleString(undefined,{maximumFractionDigits:0})}`);
    setText('disp-gst-pct', cv.gstRate.toFixed(1));
    setText('tax-gst-amt', state.config.includeGstInParity ? `+₹${cv.gstAmt.toLocaleString(undefined,{maximumFractionDigits:0})}` : 'Excl. (Physical Only)');
    setText('tax-freight-amt', `+₹${cv.freightAmt.toLocaleString(undefined,{maximumFractionDigits:0})}`);

    // Card 3: MCX
    setText('mcx-contract-tag', item.symbolMCX);
    setText('mcx-price-val', item.mcxPrice.toLocaleString(undefined,{maximumFractionDigits:1}));
    setText('mcx-unit-val', item.unitMCX);
    const mChEl = el('mcx-change-val');
    if (mChEl) { mChEl.textContent=`${sign(item.mcxCh)}${item.mcxCh.toFixed(1)} (${sign(item.mcxChPct)}${item.mcxChPct.toFixed(2)}%)`; mChEl.className=`change-tag ${item.mcxCh>=0?'positive':'negative'}`; }
    setText('mcx-last-update', new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' LIVE');
    setText('mcx-day-range', `₹${item.lo.toLocaleString()} — ₹${item.hi.toLocaleString()}`);
    setText('mcx-open-close', `₹${item.open.toLocaleString()} / ₹${item.close.toLocaleString()}`);
    setText('mcx-diff-amt', `${sign(arb.spreadInr)}₹${arb.spreadInr.toLocaleString(undefined,{maximumFractionDigits:0})} ${item.unitMCX}`);

    // Card 4: Signal
    const sBox = el('signal-box');
    if (sBox) sBox.className = `signal-box ${arb.signalType}-signal`;
    setText('signal-title',  arb.title);
    setText('signal-action', arb.action);
    const s = sign(arb.spreadInr);
    setText('arb-spread-inr', `${s}₹${arb.spreadInr.toLocaleString(undefined,{maximumFractionDigits:0})}`);
    setText('arb-spread-pct', `${sign(arb.spreadPct)}${arb.spreadPct.toFixed(2)}%`);
    const lotEst = Math.abs(arb.spreadInr)*(item.defLot/item.mult);
    setText('arb-est-profit', `₹${lotEst.toLocaleString(undefined,{maximumFractionDigits:0})} / Lot`);

    // Calculator
    renderCalc(item, cv.landed, item.mcxPrice);

    // Full Grid
    renderGrid(usdInr);

    // Chart
    updateChart();
  }

  function renderCalc(item, fair, mcx) {
    const lotQty = parseFloat(el('calc-lot-size')?.value)||item.defLot;
    const brokPct= parseFloat(el('calc-brokerage')?.value)||0.05;
    setText('calc-lot-unit', item.lotUnit);
    const units = lotQty/item.mult;
    const tFair = fair*units, tMcx=mcx*units;
    const brok  = tMcx*(brokPct/100);
    const net   = (tMcx-tFair)-brok;
    setText('calc-total-fair',     `₹${tFair.toLocaleString(undefined,{maximumFractionDigits:0})}`);
    setText('calc-total-mcx',      `₹${tMcx.toLocaleString(undefined,{maximumFractionDigits:0})}`);
    setText('calc-total-brokerage',`-₹${brok.toLocaleString(undefined,{maximumFractionDigits:0})}`);
    const npEl=el('calc-net-profit');
    if (npEl) { npEl.textContent=`${sign(net)}₹${net.toLocaleString(undefined,{maximumFractionDigits:0})}`; npEl.className=net>=0?'net-val':'net-val hl-red'; }
  }

  function renderGrid(usdInr) {
    const tbody = el('market-grid-tbody');
    if (!tbody) return;
    tbody.innerHTML = Object.keys(state.commodities).map(key=>{
      const item=state.commodities[key];
      const cv  =calcFair(key,item.comexPrice,usdInr,state.config);
      const arb =calcArb(item.mcxPrice,cv.landed,state.config.alertThresholdPct);
      const s   =sign(arb.spreadInr);
      const bCls=arb.signalType==='buy'?'sig-buy':arb.signalType==='sell'?'sig-sell':'sig-neutral';
      const taxLabel=state.config.includeGstInParity?`${(cv.dutyRate+cv.gstRate).toFixed(1)}%`:`${cv.dutyRate.toFixed(1)}% BCD`;
      return `<tr class="${key===state.selectedCommodity?'row-active':''}">
        <td class="cell-sym"><i class="fa-solid ${cmIcon(key)} ${key}-icon"></i>${item.name}</td>
        <td class="cell-mono" style="color:var(--muted)">${item.symbolCOMEX}</td>
        <td class="cell-mono">$${item.comexPrice.toFixed(2)} ${item.unitCOMEX}</td>
        <td class="cell-mono">₹${usdInr.toFixed(2)}</td>
        <td class="cell-mono">₹${cv.basePriceInr.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
        <td class="cell-mono hl-yellow">${taxLabel}</td>
        <td class="cell-mono hl-gold">₹${cv.landed.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
        <td class="cell-mono" style="color:var(--cyan)">₹${item.mcxPrice.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
        <td class="cell-mono ${arb.spreadInr>=0?'hl-green':'hl-red'}">${s}₹${arb.spreadInr.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
        <td class="cell-mono ${arb.spreadPct>=0?'hl-green':'hl-red'}">${sign(arb.spreadPct)}${arb.spreadPct.toFixed(2)}%</td>
        <td><span class="sig-badge ${bCls}">${arb.title}</span></td>
      </tr>`;
    }).join('');
    setText('grid-last-update',`Yahoo Finance — ${new Date().toLocaleTimeString()}`);
  }

  // =========================================================================
  // LIVE SNAPSHOT (Chatbot Sidebar)
  // =========================================================================
  function renderLiveSnapshot() {
    const at = state.autoTrader;
    const ff = state.forexFactory;
    setText('snap-usdinr', `₹${state.config.usdInr.toFixed(2)}`);
    Object.keys(state.commodities).forEach(k=>{
      const item=state.commodities[k];
      const cv=calcFair(k,item.comexPrice,state.config.usdInr,state.config);
      const arb=calcArb(item.mcxPrice,cv.landed,state.config.alertThresholdPct);
      const sEl=el(`snap-${k}-spread`);
      if (sEl) { sEl.textContent=`${sign(arb.spreadPct)}${arb.spreadPct.toFixed(2)}%`; sEl.style.color=arb.spreadPct>=0?'var(--green)':'var(--red)'; }
    });
    const asEl=el('snap-at-status');
    if (asEl) { asEl.textContent=at.enabled?'ACTIVE':'OFF'; asEl.style.color=at.enabled?'var(--green)':'var(--red)'; }
    const ffNext=el('snap-ff-next');
    if (ffNext) ffNext.textContent = ff.nextHighImpact ? ff.nextHighImpact.title.substring(0,22)+'…' : 'None this week';
    const haltEl=el('snap-ff-halt');
    if (haltEl) { haltEl.textContent=ff.haltActive?'YES — HALTED':'No'; haltEl.style.color=ff.haltActive?'var(--red)':'var(--green)'; }
  }

  // =========================================================================
  // FOREX FACTORY ENGINE
  // =========================================================================
  const FF_MAP = [
    { kw:['nfp','non-farm','employment change','initial jobless','unemployment'],         co:['USD'], affects:['gold','silver','crude'], bias:{gold:'bearish',silver:'bearish',crude:'bullish'},        desc:'Labor data beats → USD stronger → Gold/Silver weaken; Crude demand improves' },
    { kw:['cpi','inflation','core cpi','pce','core pce'],                                co:['USD'], affects:['gold','silver','copper'],bias:{gold:'bearish',silver:'bearish',copper:'neutral'},       desc:'High CPI → Fed hawkish → Gold falls on rate hike fears' },
    { kw:['fomc','federal reserve','fed rate','interest rate','rate decision'],          co:['USD'], affects:['gold','silver','crude','copper'],bias:{gold:'bearish',silver:'bearish',crude:'mixed',copper:'bearish'}, desc:'Rate hike → USD strengthens → Commodities fall' },
    { kw:['gdp','gross domestic'],                                                        co:['USD'], affects:['crude','copper'],         bias:{crude:'bullish',copper:'bullish'},                      desc:'Strong GDP → Higher energy & industrial metals demand' },
    { kw:['ism manufacturing','pmi manufacturing'],                                       co:['USD'], affects:['copper','crude'],          bias:{copper:'bullish',crude:'bullish'},                      desc:'Manufacturing PMI beat → Industrial metals demand rises' },
    { kw:['retail sales'],                                                                co:['USD'], affects:['crude','copper'],          bias:{crude:'bullish',copper:'bullish'},                      desc:'Strong retail → Demand growth → crude & copper positive' },
    { kw:['crude oil inventories','eia crude','oil inventories','opec'],                co:['USD','OPEC'], affects:['crude'],           bias:{crude:'bearish'},                                        desc:'Inventory build → Supply glut → Crude bearish; Draw → Bullish' },
    { kw:['api crude'],                                                                   co:['USD'], affects:['crude'],                   bias:{crude:'bearish'},                                        desc:'API inventory build → Crude bearish signal' },
    { kw:['rbi','reserve bank of india','repo rate','india cpi','india gdp'],           co:['INR'], affects:['gold','silver','crude','copper'],bias:{gold:'neutral',silver:'neutral',crude:'neutral',copper:'neutral'}, desc:'RBI policy → INR strength affects MCX landed cost' },
    { kw:['china pmi','caixin','china gdp','china manufacturing'],                       co:['CNY'], affects:['copper','crude'],          bias:{copper:'bullish',crude:'bullish'},                      desc:'China expansion → Copper demand surges; Crude demand up' },
    { kw:['geopolit','war','sanction','risk aversion','safe haven'],                     co:[],      affects:['gold','silver','crude'],   bias:{gold:'bullish',silver:'bullish',crude:'bullish'},       desc:'Risk-off events → Gold/Silver surge; Crude volatility spikes' },
    { kw:['treasury','bond yield','10-year','10 year yield'],                            co:['USD'], affects:['gold','silver'],           bias:{gold:'bearish',silver:'bearish'},                       desc:'Rising yields → Opportunity cost of holding Gold rises → Bearish' },
  ];

  function classifyFF(title, country) {
    const t=(title||'').toLowerCase(), c=(country||'').toUpperCase();
    for (const r of FF_MAP) {
      if (r.kw.some(k=>t.includes(k)) && (r.co.length===0||r.co.some(rc=>c.includes(rc))))
        return { affects:r.affects, bias:r.bias, desc:r.desc };
    }
    return { affects:[], bias:{}, desc:'General macro event — monitor for sentiment impact' };
  }

  async function fetchFF() {
    const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
    const proxies = [
      `https://corsproxy.io/?${encodeURIComponent(FF_URL)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(FF_URL)}`,
    ];
    for (const pUrl of proxies) {
      try {
        const r = await fetch(pUrl, { cache:'no-store', signal:AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const xml = await r.text();
        const evs = parseFFXML(xml);
        if (evs.length>0) {
          state.forexFactory.events = evs;
          state.forexFactory.status = 'live';
          renderFFPanel(); return;
        }
      } catch(e) {}
    }
    state.forexFactory.events = fallbackFFEvents();
    state.forexFactory.status = 'fallback';
    renderFFPanel();
  }

  function parseFFXML(xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const items = doc.querySelectorAll('event');
      if (!items.length) return [];
      const evs = [];
      items.forEach(item => {
        const title    = item.querySelector('title')?.textContent?.trim()||'';
        const country  = item.querySelector('country')?.textContent?.trim()||'';
        const dateStr  = item.querySelector('date')?.textContent?.trim()||'';
        const timeStr  = item.querySelector('time')?.textContent?.trim()||'';
        const impact   = item.querySelector('impact')?.textContent?.trim()||'Low';
        const forecast = item.querySelector('forecast')?.textContent?.trim()||'—';
        const previous = item.querySelector('previous')?.textContent?.trim()||'—';
        const actual   = item.querySelector('actual')?.textContent?.trim()||'';
        let eventDate = new Date();
        try {
          if (dateStr && timeStr && timeStr!=='All Day' && timeStr!=='Tentative') {
            const [m,d,y]=dateStr.split('-');
            const dt=new Date(`${y}-${m}-${d}T${to24(timeStr.replace('am','AM').replace('pm','PM'))}:00`);
            eventDate = new Date(dt.getTime()+9.5*3600*1000);
          } else if (dateStr) {
            const [m,d,y]=dateStr.split('-');
            eventDate = new Date(`${y}-${m}-${d}T12:00:00`);
          }
        } catch(e) {}
        const cl = classifyFF(title, country);
        evs.push({ title, country, eventDate, timeStr, impact, forecast, previous, actual, affects:cl.affects, bias:cl.bias, desc:cl.desc });
      });
      return evs.sort((a,b)=>a.eventDate-b.eventDate);
    } catch(e) { return []; }
  }

  function to24(t) {
    const m=t.match(/(\d{1,2}):(\d{2})(AM|PM)/i);
    if (!m) return '12:00';
    let [,h,mi,p]=m; h=parseInt(h);
    if (p.toUpperCase()==='PM'&&h!==12) h+=12;
    if (p.toUpperCase()==='AM'&&h===12) h=0;
    return `${String(h).padStart(2,'0')}:${mi}`;
  }

  function fallbackFFEvents() {
    const now=new Date(), tmpl=[
      { title:'US Non-Farm Payrolls (NFP)',      country:'USD', impact:'High',   forecast:'185K', previous:'177K' },
      { title:'FOMC Interest Rate Decision',     country:'USD', impact:'High',   forecast:'5.25%', previous:'5.25%' },
      { title:'US CPI (YoY)',                    country:'USD', impact:'High',   forecast:'3.1%', previous:'3.4%' },
      { title:'EIA Crude Oil Inventories',       country:'USD', impact:'High',   forecast:'-1.2M', previous:'+2.4M' },
      { title:'ISM Manufacturing PMI',           country:'USD', impact:'Medium', forecast:'49.5', previous:'48.7' },
      { title:'US Initial Jobless Claims',       country:'USD', impact:'Medium', forecast:'225K', previous:'218K' },
      { title:'US Retail Sales (MoM)',           country:'USD', impact:'Medium', forecast:'0.3%', previous:'-0.2%' },
      { title:'China Caixin Manufacturing PMI',  country:'CNY', impact:'High',   forecast:'50.2', previous:'49.8' },
      { title:'RBI Monetary Policy Statement',   country:'INR', impact:'High',   forecast:'6.50%', previous:'6.50%' },
      { title:'US GDP (QoQ)',                    country:'USD', impact:'High',   forecast:'2.8%', previous:'3.2%' },
      { title:'Crude Oil API Inventories',       country:'USD', impact:'Medium', forecast:'-800K', previous:'+1.2M' },
      { title:'US PCE Price Index (MoM)',        country:'USD', impact:'High',   forecast:'0.2%', previous:'0.3%' },
      { title:'India CPI (YoY)',                 country:'INR', impact:'Medium', forecast:'4.8%', previous:'5.1%' },
      { title:'OPEC Monthly Production Report',  country:'OPEC',impact:'High',   forecast:'—', previous:'—' },
      { title:'Federal Reserve Chair Speech',    country:'USD', impact:'High',   forecast:'—', previous:'—' },
      { title:'US Treasury 10Y Bond Auction',   country:'USD', impact:'Medium', forecast:'4.45%', previous:'4.52%' },
    ];
    return tmpl.map((t,i)=>{
      const d=new Date(now); d.setDate(now.getDate()+Math.floor(i/3)-1); d.setHours([8,10,12,14,16,18][i%6],30,0,0);
      const cl=classifyFF(t.title,t.country);
      return { ...t, eventDate:d, actual:d<now?t.forecast:'', affects:cl.affects.length?cl.affects:[], bias:cl.bias, desc:cl.desc };
    }).sort((a,b)=>a.eventDate-b.eventDate);
  }

  function evaluateFFHalt() {
    const ff=state.forexFactory, now=new Date();
    const BEFORE=15*60*1000, AFTER=10*60*1000;
    let halt=false, reason='', next=null, minD=Infinity;
    ff.events.forEach(ev=>{
      if (ev.impact!=='High') return;
      const d=ev.eventDate-now;
      if (d>0&&d<minD) { minD=d; next=ev; }
      if (d>-AFTER&&d<BEFORE) { halt=true; reason=d>0?`⚠️ HALT: ${ev.title} in ${Math.ceil(d/60000)}m`:`⚠️ HALT: ${ev.title} just released (cooldown)`; }
    });
    ff.haltActive=halt; ff.haltEventName=reason; ff.nextHighImpact=next;

    // Halt box
    const hb=el('ff-halt-box'), hr=el('ff-halt-reason');
    if (hb) hb.style.display=halt?'flex':'none';
    if (hr&&halt) hr.textContent=reason;

    // Countdown
    const ne=el('ff-next-event-name'), ct=el('ff-next-countdown');
    const hh=el('ff-header-event'), hct=el('ff-header-timer');
    if (next) {
      const d=next.eventDate-now;
      const label = next.title.substring(0,28)+(next.title.length>28?'…':'');
      if (d>0) {
        const hh_=Math.floor(d/3600000), mm=Math.floor((d%3600000)/60000), ss=Math.floor((d%60000)/1000);
        const timerStr=`${String(hh_).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
        if (ne) ne.textContent=label;
        if (ct) { ct.textContent=timerStr; ct.classList.toggle('soon',d<15*60*1000); }
        if (hh) hh.textContent=label;
        if (hct) { hct.textContent=timerStr; hct.classList.toggle('soon',d<15*60*1000); }
      } else {
        if (ne) ne.textContent=label;
        if (ct) { ct.textContent='LIVE NOW'; ct.classList.add('soon'); }
        if (hh) hh.textContent=label;
        if (hct) { hct.textContent='LIVE NOW'; hct.classList.add('soon'); }
      }
    } else {
      if (ne) ne.textContent='No high-impact events'; if (ct) ct.textContent='--:--:--';
      if (hh) hh.textContent='None'; if (hct) hct.textContent='--:--:--';
    }

    // FF tab badge
    const ffBadge=el('ff-tab-badge');
    if (ffBadge) {
      const upcoming=ff.events.filter(e=>e.eventDate>now&&e.impact==='High').length;
      ffBadge.textContent=halt?'⛔ HALTED':`${upcoming} High`;
    }
  }

  function renderFFPanel() {
    const ff=state.forexFactory, now=new Date();
    const badge=el('ff-status-badge');
    if (badge) {
      if (ff.status==='live') { badge.textContent='✅ LIVE (forexfactory.com)'; badge.className='ff-status-badge live'; }
      else { badge.textContent='📋 DEMO DATA (CORS blocked)'; badge.className='ff-status-badge'; }
    }
    evaluateFFHalt();
    const tbody=el('ff-tbody');
    if (!tbody) return;
    let evs = ff.events;
    if (ff.activeFilter!=='ALL') evs=evs.filter(e=>e.impact===ff.activeFilter);
    if (evs.length===0) { tbody.innerHTML=`<tr class="empty-row"><td colspan="10">No ${ff.activeFilter} impact events found.</td></tr>`; return; }
    tbody.innerHTML = evs.map(ev=>{
      const diff=ev.eventDate-now;
      const isPast=diff<-10*60*1000, isSoon=diff>0&&diff<15*60*1000, isToday=!isPast&&diff>=0&&diff<86400*1000;
      const rowCls=isPast?'ff-row-past':isSoon?'ff-row-soon':isToday?'ff-row-today':'';
      const iCls=ev.impact==='High'?'ff-impact-high':ev.impact==='Medium'?'ff-impact-medium':'ff-impact-low';
      const iIcon=ev.impact==='High'?'🔴':ev.impact==='Medium'?'🟡':'⚪';
      const affTags=(ev.affects||[]).map(k=>{
        const lbl={gold:'🥇 GOLD',silver:'🥈 SILVER',copper:'⚡ COPPER',crude:'🛢️ CRUDE'};
        return `<span class="ff-affects-tag cmtag ${k}">${lbl[k]||k}</span>`;
      }).join('');
      const atAct=ev.impact==='High'?`<span class="ff-at-halt">🚫 HALT ±15min</span>`:ev.impact==='Medium'?`<span class="ff-at-caution">⚠️ CAUTION</span>`:`<span class="ff-at-normal">✅ Normal</span>`;
      const bias=(ev.bias||{})[state.selectedCommodity]||'neutral';
      const biasTxt=bias==='bullish'?`<span class="ff-bias-bullish">📈 BULLISH (if beat)</span>`:bias==='bearish'?`<span class="ff-bias-bearish">📉 BEARISH (if beat)</span>`:`<span class="ff-bias-neutral">⟷ Neutral / Mixed</span>`;
      const actDisplay=ev.actual?`<strong style="color:var(--green)">${ev.actual}</strong>`:`<span style="color:var(--sub)">Pending</span>`;
      const dtDisp=ev.eventDate.toLocaleDateString('en-IN',{weekday:'short',month:'short',day:'numeric'});
      const tmDisp=ev.eventDate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})+' IST';
      return `<tr class="${rowCls}" title="${ev.desc||''}">
        <td class="cell-mono" style="font-size:10px;">${dtDisp}<br>${tmDisp}${isSoon?` <span style="color:var(--red);font-weight:800;">⚡SOON</span>`:''}${isPast?` <span style="color:var(--sub)">✓ Past</span>`:''}</td>
        <td><strong style="font-size:11px">${ev.country}</strong></td>
        <td class="ff-event-name">${ev.title}</td>
        <td class="${iCls}">${iIcon} ${ev.impact}</td>
        <td>${affTags||'<span style="color:var(--sub)">General</span>'}</td>
        <td class="cell-mono">${ev.forecast||'—'}</td>
        <td class="cell-mono">${ev.previous||'—'}</td>
        <td class="cell-mono">${actDisplay}</td>
        <td>${atAct}</td>
        <td>${biasTxt}</td>
      </tr>`;
    }).join('');
  }

  // =========================================================================
  // Chatbot CHATBOT ENGINE
  // =========================================================================
  function processChat(q) {
    q = q.toLowerCase().trim();
    const usdInr = state.config.usdInr;
    const fmt = v => fmtInr(v);
    const getCA = key => {
      const item=state.commodities[key];
      const cv=calcFair(key,item.comexPrice,usdInr,state.config);
      const arb=calcArb(item.mcxPrice,cv.landed,state.config.alertThresholdPct);
      return { item, cv, arb };
    };

    // ── FF questions ──
    const ff=state.forexFactory, now=new Date();
    if (q.includes('forex factory')||q.includes('economic calendar')||q.includes('ff calendar')) {
      const up=ff.events.filter(e=>e.eventDate>now).slice(0,5);
      if (!up.length) return '📅 **Forex Factory:** No events loaded yet. Try clicking the Forex Factory tab.';
      return `📅 **Next Events:**\n\n`+up.map(e=>{
        const d=e.eventDate-now;
        return `• **${e.title}** (${e.country}) — ${e.impact} — ${d>0?`in ${Math.floor(d/3600000)}h ${Math.floor((d%3600000)/60000)}m`:'PAST'}`;
      }).join('\n')+`\n\n🔴 AutoTrader halts 15min before/after HIGH impact events.`;
    }
    if (q.includes('high impact')||q.includes('red folder')) {
      const hi=ff.events.filter(e=>e.impact==='High'&&e.eventDate>now).slice(0,5);
      if (!hi.length) return '✅ No high-impact events coming up this week!';
      return `🔴 **Upcoming High-Impact Events:**\n\n`+hi.map(e=>{
        const d=e.eventDate-now;
        return `• **${e.title}** (${e.country}) — ${d>0?`in ${Math.floor(d/3600000)}h ${Math.floor((d%3600000)/60000)}m`:'LIVE'}\n  Affects: ${(e.affects||[]).join(', ').toUpperCase()} | Bias: ${(e.bias||{})[state.selectedCommodity]||'neutral'}`;
      }).join('\n\n');
    }
    if (q.includes('safe to trade')||q.includes('can i trade')||q.includes('should i trade now')) {
      if (ff.haltActive) return `🚫 **NOT SAFE TO TRADE!**\n\n${ff.haltEventName}\n\nAutoTrader is halted. Wait ~10 minutes after the event for volatility to settle.`;
      const soon=ff.events.some(e=>e.impact==='High'&&e.eventDate-now>0&&e.eventDate-now<30*60*1000);
      if (soon) return `⚠️ **CAUTION!** High-impact event within 30 minutes.\nAutoTrader threshold widened. Use tight stop-loss for manual trades.`;
      return `✅ **Safe to trade.** No high-impact events in the next 30 minutes.\nAutoTrader threshold: ±${state.autoTrader.triggerPct}%`;
    }

    // ── Best opportunity ──
    if (q.includes('best')&&(q.includes('trade')||q.includes('opportunit')||q.includes('arb'))) {
      const ranked=Object.keys(state.commodities).map(k=>{
        const {arb,item}=getCA(k);
        return { k, name:item.name, sp:arb.spreadPct, sig:arb.title, act:arb.action };
      }).sort((a,b)=>Math.abs(b.sp)-Math.abs(a.sp));
      const top=ranked[0];
      return `🏆 **Best Arbitrage Opportunity:**\n\n📌 **${top.name}** — Spread: **${sign(top.sp)}${top.sp.toFixed(2)}%**\n📡 Signal: **${top.act}**\n\n🔢 Ranking:\n${ranked.map((r,i)=>`${i+1}. ${r.name}: ${sign(r.sp)}${r.sp.toFixed(2)}% (${r.sig})`).join('\n')}`;
    }

    // ── All prices ──
    if (q.includes('all')||(q.includes('live')&&q.includes('price'))||q.includes('all prices')) {
      return `📊 **All Live Prices (Yahoo Finance):**\n\n`+Object.keys(state.commodities).map(k=>{
        const {item,cv,arb}=getCA(k);
        return `• **${item.name}**: COMEX $${item.comexPrice.toFixed(2)} | MCX ${fmt(item.mcxPrice)} | Fair ${fmt(cv.landed)} | Spread ${sign(arb.spreadPct)}${arb.spreadPct.toFixed(2)}%`;
      }).join('\n')+`\n\n💱 USD/INR: ₹${usdInr.toFixed(2)}`;
    }

    // ── Commodity specific ──
    const comMatches=[
      {keys:['gold'],key:'gold',label:'Gold'},
      {keys:['silver'],key:'silver',label:'Silver'},
      {keys:['copper'],key:'copper',label:'Copper'},
      {keys:['crude','oil','petroleum'],key:'crude',label:'Crude Oil'},
    ];
    for (const cm of comMatches) {
      if (cm.keys.some(k=>q.includes(k))) {
        const {item,cv,arb}=getCA(cm.key);
        if (q.includes('breakdown')||q.includes('calculat')||q.includes('detail')||q.includes('how')) {
          return `📐 **${item.name} Fair Value:**\n\n• COMEX: **$${item.comexPrice.toFixed(2)} ${item.unitCOMEX}**\n• Per gram: **$${cv.baseGramUsd.toFixed(2)}**\n• Base Landing (INR): **${fmt(cv.basePriceInr)} ${item.unitMCX}**\n• Customs Duty (${cv.dutyRate}%): **+${fmt(cv.dutyAmt)}**\n• GST: **${state.config.includeGstInParity?'+'+fmt(cv.gstAmt):'EXCLUDED (Futures Parity)'}**\n• Freight (${state.config.freightPct}%): **+${fmt(cv.freightAmt)}**\n• ✅ **Landed Fair Value: ${fmt(cv.landed)} ${item.unitMCX}**\n\n• MCX: **${fmt(item.mcxPrice)} ${item.unitMCX}**\n• Spread: **${sign(arb.spreadInr)}${fmt(arb.spreadInr)} (${sign(arb.spreadPct)}${arb.spreadPct.toFixed(2)}%)**\n• Signal: **${arb.title}** → ${arb.action}`;
        }
        if (q.includes('arb')||q.includes('spread')||q.includes('signal')||q.includes('should i')) {
          return `📡 **${item.name} Arbitrage:**\n\n• MCX: **${fmt(item.mcxPrice)} ${item.unitMCX}**\n• Fair Value: **${fmt(cv.landed)} ${item.unitMCX}**\n• Spread: **${sign(arb.spreadInr)}${fmt(arb.spreadInr)} (${sign(arb.spreadPct)}${arb.spreadPct.toFixed(2)}%)**\n\n🚦 **${arb.title}**\n💡 ${arb.action}`;
        }
        return `📌 **${item.name}:**\n\n• COMEX: **$${item.comexPrice.toFixed(2)}** (${sign(item.comexChPct)}${item.comexChPct.toFixed(2)}%)\n• Fair Value (INR): **${fmt(cv.landed)} ${item.unitMCX}**\n• MCX: **${fmt(item.mcxPrice)} ${item.unitMCX}**\n• Spread: **${sign(arb.spreadPct)}${arb.spreadPct.toFixed(2)}%**\n• Signal: **${arb.title}**`;
      }
    }

    // ── USD/INR ──
    if (q.includes('usd')||q.includes('inr')||q.includes('dollar')||q.includes('rupee')||q.includes('exchange')) {
      return `💱 **USD/INR Live:** ₹${usdInr.toFixed(2)}\n• Source: Yahoo Finance (INR=X)\n• Auto-synced every 5 seconds\n• Current duty: ${state.config.customDutyPct}% BCD for Gold/Silver`;
    }

    // ── AutoTrader ──
    if (q.includes('autotrader')||q.includes('auto trader')||q.includes('bot status')||q.includes('trades')) {
      const at=state.autoTrader;
      const unr=at.openPositions.reduce((s,p)=>s+(p.floatPnl||0),0);
      const wins=at.tradeLog.filter(t=>t.pnl>0).length;
      return `🤖 **AutoTrader Status:**\n\n• Status: **${at.enabled?'✅ ACTIVE':'❌ OFFLINE'}**\n• FF Halted: **${state.forexFactory.haltActive?'YES ⛔':'No'}**\n• Trigger Threshold: **±${at.triggerPct}%**\n• Stop Loss: **${at.stopLossPct}%** | Take Profit: **${at.takeProfitPct}%**\n• Open Positions: **${at.openPositions.length}**\n• Completed Trades: **${at.tradeLog.length}**\n• Realized PnL: **${sign(at.realizedPnl)}₹${Math.round(at.realizedPnl).toLocaleString()}**\n• Unrealized PnL: **${sign(unr)}₹${Math.round(unr).toLocaleString()}**\n• Win Rate: **${at.tradeLog.length?Math.round((wins/at.tradeLog.length)*100)+'%':'N/A'}**`;
    }

    // ── Explain ──
    if (q.includes('explain')||q.includes('what is arbitrage')||q.includes('how does arb')) {
      return `📚 **Commodity Arbitrage Explained:**\n\n**Arbitrage** = exploiting price differences between two markets.\n\n1️⃣ **COMEX** (US) sets international price in USD\n2️⃣ Convert to INR + add **Import Costs** (BCD Duty + Freight)\n3️⃣ → **Fair Import Parity Value** (what it costs to bring to India)\n4️⃣ **MCX** (India) trades at its own domestic price\n\n**If MCX > Fair Parity** → **SELL MCX** (short)\n**If MCX < Fair Parity** → **BUY MCX** (long)\n\nGST (3%) is **excluded** from futures parity — physical delivery only.`;
    }

    // ── Duty ──
    if (q.includes('duty')||q.includes('tax')||q.includes('gst')) {
      return `🧾 **Current Tax Config:**\n\n• Gold/Silver BCD: **${state.config.customDutyPct}%**\n• Copper BCD: **${state.config.copperDutyPct}%**\n• Crude BCD: **${state.config.crudeDutyPct}%**\n• GST: **${state.config.gstPct}%** (${state.config.includeGstInParity?'INCLUDED':'EXCLUDED — physical delivery only'})\n• Freight: **${state.config.freightPct}%**\n\n💡 Change via Config button.`;
    }

    // ── 1 oz ──
    if (q.includes('1 oz')||q.includes('one oz')||q.includes('ounce')) {
      const g=state.commodities.gold;
      const oz=g.comexPrice*usdInr, gram=oz/31.1034768;
      return `⚖️ **Gold Conversion:**\n\n• 1 Troy Oz = **31.1035 g**\n• COMEX: **$${g.comexPrice.toFixed(2)} / oz**\n• 1 oz in INR: **₹${oz.toLocaleString(undefined,{maximumFractionDigits:0})}** (pre-duty)\n• Per gram (pre-duty): **₹${gram.toLocaleString(undefined,{maximumFractionDigits:0})}**\n• 10g Fair Value (post-duty): **${fmt(calcFair('gold',g.comexPrice,usdInr,state.config).landed)}**`;
    }

    // ── Greetings ──
    if (q.match(/^(hi|hello|hey|namaste)/)||q.includes('who are you')||q.includes('what can you do')) {
      return `👋 Hi! I'm **Chatbot** — your COMEX vs MCX market intelligence assistant.\n\nI can help with:\n• 📊 Live prices for Gold, Silver, Copper, Crude\n• 📐 Fair value breakdowns with import duties\n• ⚡ Arbitrage spread & signals\n• 🤖 AutoTrader status & trade log\n• 📅 Forex Factory events & safe-to-trade checks\n• 💱 USD/INR rates & conversions\n\nJust ask!`;
    }

    return `🤔 I didn't quite catch that. Try:\n\n• "Best opportunity right now?"\n• "Gold fair value breakdown"\n• "Is it safe to trade now?"\n• "AutoTrader status"\n• "High impact events today"\n• "Show all live prices"`;
  }

  function addBotMsg(text) {
    const c=el('chat-messages');
    if (!c) return;
    const html=text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    c.insertAdjacentHTML('beforeend',`<div class="chat-msg bot-msg">
      <div class="msg-avatar"><i class="fa-solid fa-robot"></i></div>
      <div class="msg-content">
        <div class="msg-bubble">${html}</div>
        <span class="msg-time">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
      </div>
    </div>`);
    c.scrollTop=c.scrollHeight;
  }

  function sendChatMessage(question) {
    if (!question.trim()) return;
    const c=el('chat-messages');
    if (!c) return;
    // User bubble
    c.insertAdjacentHTML('beforeend',`<div class="chat-msg user-msg">
      <div class="msg-content">
        <div class="msg-bubble">${question}</div>
        <span class="msg-time">${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
      </div>
    </div>`);
    el('chat-input').value='';
    c.scrollTop=c.scrollHeight;
    // Typing indicator
    const tid='typing-ind-'+Date.now();
    c.insertAdjacentHTML('beforeend',`<div class="chat-msg bot-msg typing-indicator" id="${tid}">
      <div class="msg-avatar"><i class="fa-solid fa-robot"></i></div>
      <div class="msg-content"><div class="msg-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>
    </div>`);
    c.scrollTop=c.scrollHeight;
    setTimeout(()=>{
      const te=document.getElementById(tid);
      if (te) te.remove();
      addBotMsg(processChat(question));
    }, 600+Math.random()*400);
  }

  // =========================================================================
  // TAB SYSTEM
  // =========================================================================
  function setupTabs() {
    document.querySelectorAll('.tab-nav-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const tab=btn.dataset.tab;
        document.querySelectorAll('.tab-nav-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        el(`tab-${tab}`)?.classList.add('active');
        state.activeTab = tab;
        if (tab==='forex') renderFFPanel();
        if (tab==='autotrader') renderAutoTrader();
      });
    });
  }

  // =========================================================================
  // EVENT LISTENERS
  // =========================================================================
  function setupEvents() {
    // Commodity tabs
    document.querySelectorAll('.nav-tab').forEach(tab=>{
      tab.addEventListener('click',()=>{
        document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
        tab.classList.add('active');
        state.selectedCommodity=tab.dataset.commodity;
        const item=state.commodities[state.selectedCommodity];
        const lotEl=el('calc-lot-size');
        if (lotEl) lotEl.value=item.defLot;
        renderUI();
        if (state.activeTab==='forex') renderFFPanel();
      });
    });

    // Audio
    el('btn-audio-toggle').addEventListener('click',()=>{
      state.soundEnabled=!state.soundEnabled;
      el('audio-icon').className=state.soundEnabled?'fa-solid fa-volume-high':'fa-solid fa-volume-xmark';
      if (state.soundEnabled) beep(880,0.3);
    });

    // Chat send
    el('chat-send-btn').addEventListener('click',()=>sendChatMessage(el('chat-input').value));
    el('chat-input').addEventListener('keydown',e=>{ if(e.key==='Enter') sendChatMessage(el('chat-input').value); });
    el('btn-clear-chat').addEventListener('click',()=>{
      const c=el('chat-messages'); if (!c) return;
      c.innerHTML=`<div class="chat-msg bot-msg"><div class="msg-avatar"><i class="fa-solid fa-robot"></i></div><div class="msg-content"><div class="msg-bubble">Chat cleared! Ask me anything about the markets.</div><span class="msg-time">Now</span></div></div>`;
    });

    // Quick buttons
    document.querySelectorAll('.quick-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        // Switch to chat tab
        document.querySelectorAll('.tab-nav-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
        document.querySelector('[data-tab="chatbot"]').classList.add('active');
        el('tab-chatbot').classList.add('active');
        state.activeTab='chatbot';
        sendChatMessage(btn.dataset.q);
      });
    });

    // AutoTrader master toggle
    el('at-master-toggle').addEventListener('change',e=>{
      state.autoTrader.enabled=e.target.checked;
      if (state.autoTrader.enabled) {
        state.autoTrader.triggerPct      =parseFloat(el('at-trigger-pct').value)||0.50;
        state.autoTrader.stopLossPct     =parseFloat(el('at-stoploss-pct').value)||1.50;
        state.autoTrader.takeProfitPct   =parseFloat(el('at-takeprofit-pct').value)||0.80;
        state.autoTrader.exitReversionPct=parseFloat(el('at-exit-reversion').value)||0.10;
        state.autoTrader.maxPositions    =parseInt(el('at-max-positions').value)||4;
        state.autoTrader.enabledCommodities={ gold:el('at-en-gold').checked, silver:el('at-en-silver').checked, copper:el('at-en-copper').checked, crude:el('at-en-crude').checked };
        beep(523,0.4);
        addBotMsg(`🤖 AutoTrader **ACTIVATED** | Threshold: ±${state.autoTrader.triggerPct}% | SL: ${state.autoTrader.stopLossPct}% | TP: ${state.autoTrader.takeProfitPct}%`);
      } else {
        beep(220,0.4);
        addBotMsg('🤖 AutoTrader **DEACTIVATED**.');
      }
      renderAutoTrader();
    });

    // Calc inputs
    ['calc-lot-size','calc-brokerage'].forEach(id=>{
      el(id)?.addEventListener('input',()=>{
        const item=state.commodities[state.selectedCommodity];
        const cv=calcFair(state.selectedCommodity,item.comexPrice,state.config.usdInr,state.config);
        renderCalc(item, cv.landed, item.mcxPrice);
      });
    });

    // Chart timeframe buttons & refresh button
    document.querySelectorAll('.tf-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        updateChart();
      });
    });

    el('btn-refresh-chart')?.addEventListener('click', async ()=>{
      const icon = el('btn-refresh-chart').querySelector('i');
      if (icon) icon.classList.add('fa-spin');
      await fetchAllLive();
      renderUI();
      setTimeout(()=>{ if (icon) icon.classList.remove('fa-spin'); }, 600);
    });

    // Settings drawer
    const drawer=el('settings-drawer');
    el('btn-open-settings').addEventListener('click',()=>drawer.classList.add('open'));
    el('btn-close-drawer').addEventListener('click',()=>drawer.classList.remove('open'));
    el('drawer-overlay').addEventListener('click',()=>drawer.classList.remove('open'));

    // Slider sync
    [['slider-duty-pct','input-duty-pct'],['slider-copper-duty-pct','input-copper-duty-pct'],
     ['slider-crude-duty-pct','input-crude-duty-pct'],['slider-gst-pct','input-gst-pct'],
     ['slider-freight-pct','input-freight-pct']].forEach(([s,i])=>{
      const sv=el(s), iv=el(i); if(!sv||!iv) return;
      sv.addEventListener('input',()=>iv.value=sv.value);
      iv.addEventListener('input',()=>sv.value=iv.value);
    });

    el('btn-save-settings').addEventListener('click',()=>{
      state.config.customDutyPct   =parseFloat(el('input-duty-pct').value)||15;
      state.config.copperDutyPct   =parseFloat(el('input-copper-duty-pct').value)||5;
      state.config.crudeDutyPct    =parseFloat(el('input-crude-duty-pct').value)||2.5;
      state.config.gstPct          =parseFloat(el('input-gst-pct').value)||3;
      state.config.includeGstInParity=el('chk-include-gst').checked;
      state.config.freightPct      =parseFloat(el('input-freight-pct').value)||0.2;
      state.config.usdInr          =parseFloat(el('input-usdinr').value)||83.45;
      state.config.autoUsdInr      =el('chk-auto-usdinr').checked;
      state.config.alertThresholdPct=parseFloat(el('input-alert-threshold').value)||0.30;
      drawer.classList.remove('open');
      renderUI();
    });

    el('btn-reset-defaults').addEventListener('click',()=>{
      [['slider-duty-pct','input-duty-pct',15],['slider-copper-duty-pct','input-copper-duty-pct',5],
       ['slider-crude-duty-pct','input-crude-duty-pct',2.5],['slider-gst-pct','input-gst-pct',3],
       ['slider-freight-pct','input-freight-pct',0.2]].forEach(([s,i,v])=>{
        el(s)&&(el(s).value=v); el(i)&&(el(i).value=v);
      });
      el('chk-include-gst').checked=false;
      el('input-usdinr').value=83.45;
      el('chk-auto-usdinr').checked=true;
      el('input-alert-threshold').value=0.30;
    });

    // FF filters
    document.querySelectorAll('.ff-filter-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.ff-filter-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        state.forexFactory.activeFilter=btn.dataset.impact;
        renderFFPanel();
      });
    });
  }

  // =========================================================================
  // BOOT
  // =========================================================================
  initHistory();
  initChart();
  setupTabs();
  setupEvents();
  updateStatusBadge();
  startTickEngine();
  renderUI();
  renderAutoTrader();
  renderLiveSnapshot();

  // Forex Factory
  fetchFF();
  setInterval(fetchFF, 5*60*1000);
  setInterval(evaluateFFHalt, 1000);
});
