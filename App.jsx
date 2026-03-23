import { useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

class ThermalConstants {
  static CONDUCTIVITY = {
    Concrete:   1.7,
    Brick:      0.6,
    Insulation: 0.04,
    Wood:       0.15,
  };

  static U_VALUES = {
    Single: 5.7,
    Double: 2.8,
    Triple: 1.0,
  };

  static HEATING_SEASON_DAYS       = 180;
  static RESALE_SAVINGS_MULTIPLIER = 7;

  static conductivity(material) { return this.CONDUCTIVITY[material] ?? 1.7; }
  static uValue(windowType)     { return this.U_VALUES[windowType]   ?? 5.7; }
}

class EfficiencyGrade {
  static THRESHOLDS = [
    { grade: "A", max: 20 },
    { grade: "B", max: 35 },
    { grade: "C", max: 50 },
    { grade: "D", max: 70 },
  ];

  static LABELS = { A: "<$20", B: "<$35", C: "<$50", D: "<$70", E: ">$70" };

  static fromCostPerM2(costPerM2) {
    for (const { grade, max } of this.THRESHOLDS) {
      if (costPerM2 < max) return grade;
    }
    return "E";
  }

  static label(grade) { return this.LABELS[grade] ?? ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEAT LOSS MODEL
// ─────────────────────────────────────────────────────────────────────────────

class HeatLossResult {
  constructor({ wallHeat, winHeat, total, deltaT }) {
    this.wallHeat = wallHeat;
    this.winHeat  = winHeat;
    this.total    = total;
    this.deltaT   = deltaT;
  }
}

class HeatLossCalculator {
  static calculate({ wallArea, wallThickness, windowArea, wallMaterial, windowType, outsideTemp, insideTemp }) {
    const deltaT  = insideTemp - outsideTemp;
    const k       = ThermalConstants.conductivity(wallMaterial);
    const U_wall  = k / Math.max(wallThickness, 0.01);
    const U_win   = ThermalConstants.uValue(windowType);
    const wallHeat = U_wall * (wallArea - windowArea) * deltaT;
    const winHeat  = U_win  * windowArea * deltaT;
    return new HeatLossResult({
      wallHeat: Math.max(0, wallHeat),
      winHeat:  Math.max(0, winHeat),
      total:    Math.max(0, wallHeat + winHeat),
      deltaT,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENERGY MODEL
// ─────────────────────────────────────────────────────────────────────────────

class AnnualEnergyCalculator {
  static calculate(totalHeatLossW, efficiencyPct) {
    const days = ThermalConstants.HEATING_SEASON_DAYS;
    const eff  = Math.max(1, efficiencyPct) / 100;
    return (totalHeatLossW * 24 * days) / (1000 * eff);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO MODEL
// ─────────────────────────────────────────────────────────────────────────────

class ScenarioResult {
  constructor({ heatLoss, kWh, cost, costPerM2, grade }) {
    this.wallHeat  = heatLoss.wallHeat;
    this.winHeat   = heatLoss.winHeat;
    this.total     = heatLoss.total;
    this.deltaT    = heatLoss.deltaT;
    this.kWh       = kWh;
    this.cost      = cost;
    this.costPerM2 = costPerM2;
    this.grade     = grade;
  }
}

class ScenarioEngine {
  static run(inputs, wallMat, winType) {
    const heatLoss  = HeatLossCalculator.calculate({ ...inputs, wallMaterial: wallMat, windowType: winType });
    const kWh       = AnnualEnergyCalculator.calculate(heatLoss.total, inputs.efficiencyPct);
    const cost      = kWh * inputs.electricityPrice;
    const costPerM2 = cost / (inputs.floorArea || 1);
    return new ScenarioResult({ heatLoss, kWh, cost, costPerM2, grade: EfficiencyGrade.fromCostPerM2(costPerM2) });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

class AnalysisResult {
  constructor({ base, upgraded, annualSavings, resalePremium }) {
    this.base          = base;
    this.upgraded      = upgraded;
    this.annualSavings = annualSavings;
    this.resalePremium = resalePremium;
  }
}

class AnalysisEngine {
  static run(inputs) {
    const base     = ScenarioEngine.run(inputs, inputs.wallMaterial, inputs.windowType);
    const upgraded = ScenarioEngine.run(inputs, inputs.upgradeWall,  inputs.upgradeWin);
    const annualSavings = base.cost - upgraded.cost;
    const resalePremium = annualSavings * ThermalConstants.RESALE_SAVINGS_MULTIPLIER;
    return new AnalysisResult({ base, upgraded, annualSavings, resalePremium });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI FORECAST SERVICE
// ─────────────────────────────────────────────────────────────────────────────

class ForecastPromptBuilder {
  static build(inputs, analysis) {
    const { base, upgraded, annualSavings, resalePremium } = analysis;
    return `You are a real estate and energy efficiency analyst. Based on the following property data, provide a detailed investment forecast in JSON.

Property Data:
- Region: ${inputs.region}
- Postal Code: ${inputs.postalCode || "N/A"}
- Current Value: $${inputs.homeValue.toLocaleString()}
- Square Footage: ${inputs.sqFt} sq ft
- Current Energy Cost: $${base.cost.toFixed(0)}/year
- Upgraded Energy Cost: $${upgraded.cost.toFixed(0)}/year
- Annual Savings: $${annualSavings.toFixed(0)}
- Estimated Resale Premium: $${resalePremium.toFixed(0)}
- Current Efficiency Grade: ${base.grade}
- Upgraded Efficiency Grade: ${upgraded.grade}
- Wall upgrade: ${inputs.wallMaterial} → ${inputs.upgradeWall}
- Window upgrade: ${inputs.windowType} → ${inputs.upgradeWin}

Return ONLY valid JSON with this exact structure:
{
  "regionSummary": "2-3 sentence market summary",
  "marketTrend": "Rising|Stable|Declining",
  "avgAnnualAppreciation": 3.2,
  "forecast5yr": { "low": 480000, "mid": 520000, "high": 570000 },
  "forecast10yr": { "low": 530000, "mid": 610000, "high": 700000 },
  "forecast10yrUpgraded": { "low": 545000, "mid": 628000, "high": 720000 },
  "upgradePremiumDollars": 18500,
  "upgradePremiumExplanation": "Short explanation",
  "neighbourhoodFactors": ["Factor 1", "Factor 2", "Factor 3"],
  "topUpgradeROI": [
    { "name": "Wall Insulation", "roi": 82, "note": "Short note" },
    { "name": "Triple Glazing",  "roi": 67, "note": "Short note" }
  ],
  "investorTip": "One actionable tip",
  "riskFactors": ["Risk 1", "Risk 2", "Risk 3"]
}`;
  }
}

class ForecastApiClient {
  static MODEL    = "claude-sonnet-4-20250514";
  static MAX_TOK  = 1000;
  static ENDPOINT = "https://api.anthropic.com/v1/messages";

  static async fetch(prompt) {
    const res  = await window.fetch(this.ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model: this.MODEL, max_tokens: this.MAX_TOK, messages: [{ role: "user", content: prompt }] }),
    });
    const data  = await res.json();
    const text  = (data.content ?? []).map(b => b.text ?? "").join("");
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  }
}

class ForecastService {
  static async run(inputs, analysis) {
    const prompt = ForecastPromptBuilder.build(inputs, analysis);
    return ForecastApiClient.fetch(prompt);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

class Fmt {
  static currency(v)      { return `$${Math.round(v).toLocaleString()}`; }
  static compact(v)       { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0); }
  static trendColor(t)    { return t === "Rising" ? "#22c55e" : t === "Declining" ? "#ef4444" : "#eab308"; }
  static trendArrow(t)    { return t === "Rising" ? "↑"       : t === "Declining" ? "↓"       : "→"; }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT INPUTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_INPUTS = {
  floorArea: 120, wallArea: 280, wallThickness: 0.25, windowArea: 30,
  wallMaterial: "Brick", windowType: "Double",
  outsideTemp: -5, insideTemp: 21, electricityPrice: 0.15, efficiencyPct: 85,
  upgradeWall: "Insulation", upgradeWin: "Triple",
  homeValue: 450000, sqFt: 1292, postalCode: "", region: "",
};

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE FONTS + GLOBAL STYLES
// ─────────────────────────────────────────────────────────────────────────────

const FontLink    = () => <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');`}</style>;
const GlobalStyles = () => (
  <style>{`
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { background: #060912; color: #e2e8f0; font-family: 'DM Sans', sans-serif; min-height: 100vh; }
    :root {
      --bg:#060912; --surface:#0d1120; --border2:rgba(255,255,255,0.06);
      --indigo:#6366f1; --orange:#f97316; --red:#ef4444; --text:#e2e8f0;
    }
    input, select { background:#0a0f1e; border:1px solid var(--border2); color:var(--text); border-radius:8px; padding:9px 12px; font-family:'DM Sans',sans-serif; font-size:14px; width:100%; outline:none; transition:border-color 0.2s; }
    input:focus, select:focus { border-color:var(--indigo); box-shadow:0 0 0 3px rgba(99,102,241,0.12); }
    input[type=range] { padding:0; background:transparent; border:none; box-shadow:none; cursor:pointer; height:20px; }
    select option { background:#0d1120; }
    @keyframes slideUp { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fillBar { from{width:0} to{width:var(--w)} }
    @keyframes spin    { to{transform:rotate(360deg)} }
    @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .slide-up { animation:slideUp 0.55s cubic-bezier(0.22,1,0.36,1) both; }
    .bar-fill  { animation:fillBar  0.9s  cubic-bezier(0.22,1,0.36,1) both; }
    ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:#0a0f1e} ::-webkit-scrollbar-thumb{background:#1e2740;border-radius:4px}
  `}</style>
);

// ─────────────────────────────────────────────────────────────────────────────
// SVG LOGO
// ─────────────────────────────────────────────────────────────────────────────

const Logo = () => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
    <polygon points="22,4 40,18 4,18"        fill="#6366f1" opacity="0.9"/>
    <polygon points="22,4 40,18 40,16 22,2"  fill="#4f46e5"/>
    <polygon points="22,4 4,18 4,16 22,2"    fill="#818cf8"/>
    <rect x="6"  y="18" width="32" height="22" rx="1" fill="#1e2235"/>
    <rect x="6"  y="18" width="32" height="2"         fill="#2d3555"/>
    <rect x="17" y="30" width="10" height="10" rx="1" fill="#0f1424"/>
    <circle cx="25" cy="35" r="1"   fill="#6366f1"/>
    <circle cx="10" cy="26" r="5"   fill="#1a1f35" stroke="#f97316" strokeWidth="1.5"/>
    <circle cx="10" cy="26" r="2.5" fill="#0f1424"/>
    <line x1="10" y1="26" x2="12.5" y2="22.5" stroke="#f97316" strokeWidth="1.2" strokeLinecap="round"/>
    <circle cx="10" cy="26" r="1"   fill="#f97316"/>
    <rect x="27" y="20" width="8" height="7" rx="0.5" fill="#1a2540" stroke="#2d3f6e" strokeWidth="0.5"/>
    <line x1="31" y1="20" x2="31" y2="27" stroke="#2d3f6e" strokeWidth="0.5"/>
    <line x1="27" y1="23.5" x2="35" y2="23.5" stroke="#2d3f6e" strokeWidth="0.5"/>
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE UI COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

const InputField = ({ label, hint, children }) => (
  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
    <label style={{ fontSize:12, fontWeight:600, color:"#94a3b8", letterSpacing:"0.06em", textTransform:"uppercase" }}>{label}</label>
    {children}
    {hint && <span style={{ fontSize:11, color:"#475569" }}>{hint}</span>}
  </div>
);

const Card = ({ label, value, sub, accent="#6366f1", delay=0 }) => (
  <div className="slide-up" style={{ animationDelay:`${delay}ms`, background:"#0d1120", borderRadius:12, padding:"18px 20px", borderLeft:`3px solid ${accent}`, position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", top:-20, right:-20, width:80, height:80, background:`radial-gradient(circle,${accent}22 0%,transparent 70%)`, pointerEvents:"none" }}/>
    <div style={{ fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>{label}</div>
    <div style={{ fontSize:26, fontWeight:700, fontFamily:"Syne", color:"#f1f5f9", lineHeight:1 }}>{value}</div>
    {sub && <div style={{ fontSize:12, color:"#64748b", marginTop:6 }}>{sub}</div>}
  </div>
);

const SectionHeader = ({ num, title }) => (
  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18 }}>
    <span style={{ fontFamily:"Syne", fontSize:10, fontWeight:700, color:"#6366f1", border:"1px solid #6366f120", borderRadius:4, padding:"2px 6px", letterSpacing:"0.08em" }}>{num}</span>
    <span style={{ fontFamily:"Syne", fontWeight:700, fontSize:14, color:"#e2e8f0", letterSpacing:"0.03em" }}>{title}</span>
  </div>
);

const Panel = ({ children, delay=0, style={} }) => (
  <div className="slide-up" style={{ animationDelay:`${delay}ms`, background:"#0d1120", borderRadius:14, padding:24, border:"1px solid rgba(255,255,255,0.05)", ...style }}>
    {children}
  </div>
);

const SectionLabel = ({ children }) => (
  <div style={{ fontFamily:"Syne", fontWeight:700, fontSize:13, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" }}>{children}</div>
);

const CardGrid = ({ children }) => (
  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:14 }}>{children}</div>
);

const BarChart = ({ rows, delay=0 }) => (
  <div className="slide-up" style={{ animationDelay:`${delay}ms`, background:"#0d1120", borderRadius:12, padding:20, border:"1px solid rgba(255,255,255,0.05)" }}>
    {rows.map((r, i) => {
      const pct = Math.min(100, (r.value / r.max) * 100);
      return (
        <div key={i} style={{ marginBottom: i < rows.length - 1 ? 16 : 0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:12, color:"#94a3b8", fontWeight:500 }}>{r.label}</span>
            <span style={{ fontSize:12, fontWeight:700, color:r.color||"#e2e8f0" }}>{r.display}</span>
          </div>
          <div style={{ background:"#1a2035", borderRadius:6, height:10, overflow:"hidden" }}>
            <div className="bar-fill" style={{ "--w":`${pct}%`, height:"100%", background:`linear-gradient(90deg,${r.color||"#6366f1"},${r.color2||r.color||"#818cf8"})`, borderRadius:6 }}/>
          </div>
        </div>
      );
    })}
  </div>
);

const GaugeMeter = ({ grade }) => {
  const grades = ["A","B","C","D","E"];
  const colors = { A:"#22c55e", B:"#84cc16", C:"#eab308", D:"#f97316", E:"#ef4444" };
  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      {grades.map(g => (
        <div key={g} style={{ flex:1, minWidth:48, padding:"10px 4px", borderRadius:8, textAlign:"center", background:grade===g?colors[g]+"22":"#0a0f1e", border:`1.5px solid ${grade===g?colors[g]:"#1e2740"}`, transition:"all 0.3s" }}>
          <div style={{ fontFamily:"Syne", fontWeight:800, fontSize:18, color:grade===g?colors[g]:"#2d3a55" }}>{g}</div>
          <div style={{ fontSize:10, color:grade===g?colors[g]+"aa":"#2d3a55", marginTop:2 }}>{EfficiencyGrade.label(g)}</div>
        </div>
      ))}
    </div>
  );
};

const ForecastRow = ({ label, low, mid, high, color="#6366f1" }) => {
  const fmt    = v => `$${Math.round(v).toLocaleString()}`;
  const midPct = ((mid - low) / ((high - low) || 1)) * 80 + 10;
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:12, color:"#94a3b8", fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
      <div style={{ position:"relative", height:32, background:"#0a0f1e", borderRadius:8 }}>
        <div style={{ position:"absolute", left:"5%", right:"5%", top:"50%", transform:"translateY(-50%)", height:6, background:`linear-gradient(90deg,${color}44,${color})`, borderRadius:4 }}/>
        {[{ pct:5, v:low, lbl:"Low" }, { pct:midPct, v:mid, lbl:"Mid" }, { pct:95, v:high, lbl:"High" }].map(({ pct, v, lbl }) => (
          <div key={lbl} style={{ position:"absolute", left:`${pct}%`, top:"50%", transform:"translate(-50%,-50%)" }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:color, border:"2px solid #060912" }}/>
            <div style={{ position:"absolute", top:14,   left:"50%", transform:"translateX(-50%)", whiteSpace:"nowrap", fontSize:10, color, fontWeight:700 }}>{fmt(v)}</div>
            <div style={{ position:"absolute", bottom:14, left:"50%", transform:"translateX(-50%)", whiteSpace:"nowrap", fontSize:9, color:"#475569" }}>{lbl}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB VIEWS
// ─────────────────────────────────────────────────────────────────────────────

const InputsTab = ({ inputs, set, num, onRunAnalysis }) => {
  const grid2 = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 };
  const wallKeys   = Object.keys(ThermalConstants.CONDUCTIVITY);
  const windowKeys = Object.keys(ThermalConstants.U_VALUES);

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(420px,1fr))", gap:20 }}>

      <Panel delay={0}>
        <SectionHeader num="01" title="Building Geometry"/>
        <div style={grid2}>
          <InputField label="Floor Area (m²)">     <input type="number" value={inputs.floorArea}    onChange={e=>num("floorArea",e.target.value)}/></InputField>
          <InputField label="Wall Area (m²)">      <input type="number" value={inputs.wallArea}     onChange={e=>num("wallArea",e.target.value)}/></InputField>
          <InputField label="Wall Thickness (m)">  <input type="number" step="0.01" value={inputs.wallThickness} onChange={e=>num("wallThickness",e.target.value)}/></InputField>
          <InputField label="Window Area (m²)">    <input type="number" value={inputs.windowArea}   onChange={e=>num("windowArea",e.target.value)}/></InputField>
          <InputField label="Wall Material">
            <select value={inputs.wallMaterial} onChange={e=>set("wallMaterial",e.target.value)}>
              {wallKeys.map(o=><option key={o}>{o}</option>)}
            </select>
          </InputField>
          <InputField label="Window Type">
            <select value={inputs.windowType} onChange={e=>set("windowType",e.target.value)}>
              {windowKeys.map(o=><option key={o}>{o} Glazing</option>)}
            </select>
          </InputField>
        </div>
      </Panel>

      <Panel delay={80}>
        <SectionHeader num="02" title="Climate & Energy"/>
        <div style={grid2}>
          <InputField label="Outside Temp (°C)">       <input type="number" value={inputs.outsideTemp}       onChange={e=>num("outsideTemp",e.target.value)}/></InputField>
          <InputField label="Inside Temp (°C)">        <input type="number" value={inputs.insideTemp}        onChange={e=>num("insideTemp",e.target.value)}/></InputField>
          <InputField label="Electricity Price ($/kWh)"><input type="number" step="0.01" value={inputs.electricityPrice} onChange={e=>num("electricityPrice",e.target.value)}/></InputField>
          <InputField label={`Heating Efficiency: ${inputs.efficiencyPct}%`} hint="Drag to adjust">
            <input type="range" min="50" max="100" value={inputs.efficiencyPct} onChange={e=>num("efficiencyPct",e.target.value)} style={{accentColor:"#6366f1"}}/>
          </InputField>
        </div>
      </Panel>

      <Panel delay={160}>
        <SectionHeader num="03" title="Upgrade Scenario"/>
        <div style={grid2}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:"#475569", marginBottom:10, textTransform:"uppercase", letterSpacing:"0.07em" }}>Current</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <div style={{ background:"#0a0f1e", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#64748b" }}>🧱 {inputs.wallMaterial}</div>
              <div style={{ background:"#0a0f1e", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#64748b" }}>🪟 {inputs.windowType} Glazing</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:"#6366f1", marginBottom:10, textTransform:"uppercase", letterSpacing:"0.07em" }}>Upgraded</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <select value={inputs.upgradeWall} onChange={e=>set("upgradeWall",e.target.value)} style={{ background:"#0a0f1e", border:"1px solid rgba(99,102,241,0.3)", color:"#818cf8", borderRadius:8, padding:"8px 12px", fontSize:13, outline:"none" }}>
                {wallKeys.map(o=><option key={o}>{o}</option>)}
              </select>
              <select value={inputs.upgradeWin} onChange={e=>set("upgradeWin",e.target.value)} style={{ background:"#0a0f1e", border:"1px solid rgba(99,102,241,0.3)", color:"#818cf8", borderRadius:8, padding:"8px 12px", fontSize:13, outline:"none" }}>
                {windowKeys.map(o=><option key={o}>{o} Glazing</option>)}
              </select>
            </div>
          </div>
        </div>
      </Panel>

      <Panel delay={200}>
        <SectionHeader num="04" title="Property & Market Data"/>
        <div style={{ ...grid2, marginBottom:20 }}>
          <InputField label="Home Value ($)">   <input type="number" value={inputs.homeValue} onChange={e=>num("homeValue",e.target.value)}/></InputField>
          <InputField label="Square Footage">   <input type="number" value={inputs.sqFt}      onChange={e=>num("sqFt",e.target.value)}/></InputField>
          <InputField label="Postal Code">      <input type="text"   value={inputs.postalCode} onChange={e=>set("postalCode",e.target.value)} placeholder="e.g. M5V 3A8"/></InputField>
          <InputField label="Region" hint="e.g. Concord, ON or Vancouver, BC">
            <input type="text" value={inputs.region} onChange={e=>set("region",e.target.value)} placeholder="City, Province/State"/>
          </InputField>
        </div>
        <button onClick={onRunAnalysis}
          style={{ width:"100%", padding:"14px 24px", background:"linear-gradient(135deg,#4f46e5,#6366f1,#818cf8)", border:"none", borderRadius:10, color:"#fff", fontFamily:"Syne", fontWeight:800, fontSize:15, cursor:"pointer", letterSpacing:"0.03em", boxShadow:"0 8px 24px rgba(99,102,241,0.35)", transition:"transform 0.15s,box-shadow 0.15s" }}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 12px 32px rgba(99,102,241,0.45)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 8px 24px rgba(99,102,241,0.35)";}}>
          ▶ Run Analysis
        </button>
      </Panel>
    </div>
  );
};

// ── Analysis Tab ──────────────────────────────────────────────────────────────

const AnalysisTab = ({ results, inputs, onRunAI, onGoToInputs }) => {
  if (!results) return (
    <div style={{ textAlign:"center", padding:"80px 0", color:"#475569" }}>
      <div style={{ fontSize:40, marginBottom:16 }}>📊</div>
      <div style={{ fontFamily:"Syne", fontSize:18, marginBottom:8 }}>No results yet</div>
      <div style={{ fontSize:14 }}>Fill in the inputs and click Run Analysis</div>
      <button onClick={onGoToInputs} style={{ marginTop:20, padding:"10px 24px", background:"#6366f1", border:"none", borderRadius:8, color:"#fff", fontFamily:"Syne", fontWeight:700, cursor:"pointer" }}>Go to Inputs</button>
    </div>
  );

  const { base, upgraded, annualSavings, resalePremium } = results;
  const maxKwh  = Math.max(base.kWh,  upgraded.kWh)  * 1.1;
  const maxCost = Math.max(base.cost, upgraded.cost)  * 1.1;
  const maxVal  = (inputs.homeValue + resalePremium)  * 1.05;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      <div><SectionLabel>Heat Loss Analysis</SectionLabel><CardGrid style={{marginTop:14}}>
        <Card label="Total Heat Loss"  value={`${Fmt.compact(base.total)} W`}    sub="Combined wall + window"           accent="#ef4444" delay={0}/>
        <Card label="Wall Heat Loss"   value={`${Fmt.compact(base.wallHeat)} W`} sub={`Material: ${inputs.wallMaterial}`} accent="#f97316" delay={80}/>
        <Card label="Window Heat Loss" value={`${Fmt.compact(base.winHeat)} W`}  sub={`${inputs.windowType} glazing`}    accent="#eab308" delay={160}/>
        <Card label="Delta-T"          value={`${base.deltaT.toFixed(1)} °C`}    sub="Temperature differential"         accent="#6366f1" delay={240}/>
      </CardGrid></div>

      <div><SectionLabel>Annual Energy Costs</SectionLabel><CardGrid style={{marginTop:14}}>
        <Card label="Energy Use"       value={`${Math.round(base.kWh).toLocaleString()} kWh`} sub="Per heating season" accent="#6366f1" delay={0}/>
        <Card label="Heating Cost"     value={Fmt.currency(base.cost)}                        sub="Annual"             accent="#f97316" delay={80}/>
        <Card label="Cost per m²/yr"   value={`$${base.costPerM2.toFixed(1)}`}               sub="Floor area basis"   accent="#22c55e" delay={160}/>
        <Card label="Efficiency Grade" value={base.grade}                                     sub="A=best, E=worst"    accent="#818cf8" delay={240}/>
      </CardGrid></div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <div><SectionLabel>Energy Usage</SectionLabel>
          <BarChart delay={100} rows={[
            { label:"Base",     value:base.kWh,     max:maxKwh,  display:`${Math.round(base.kWh).toLocaleString()} kWh`,     color:"#ef4444", color2:"#f97316" },
            { label:"Upgraded", value:upgraded.kWh, max:maxKwh,  display:`${Math.round(upgraded.kWh).toLocaleString()} kWh`, color:"#22c55e", color2:"#84cc16" },
          ]}/></div>
        <div><SectionLabel>Heating Cost</SectionLabel>
          <BarChart delay={150} rows={[
            { label:"Base",     value:base.cost,     max:maxCost, display:Fmt.currency(base.cost),     color:"#ef4444", color2:"#f97316" },
            { label:"Upgraded", value:upgraded.cost, max:maxCost, display:Fmt.currency(upgraded.cost), color:"#22c55e", color2:"#84cc16" },
          ]}/></div>
      </div>

      <Panel delay={200}>
        <SectionLabel>Efficiency Grade</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginTop:12 }}>
          <div><div style={{fontSize:12,color:"#64748b",marginBottom:8}}>Current ({inputs.wallMaterial} + {inputs.windowType})</div><GaugeMeter grade={base.grade}/></div>
          <div><div style={{fontSize:12,color:"#6366f1",marginBottom:8}}>Upgraded ({inputs.upgradeWall} + {inputs.upgradeWin})</div><GaugeMeter grade={upgraded.grade}/></div>
        </div>
      </Panel>

      <div><SectionLabel>Resale Value Impact</SectionLabel><CardGrid style={{marginTop:14}}>
        <Card label="Base Property Value" value={Fmt.currency(inputs.homeValue)}                 sub="Current market value"          accent="#64748b" delay={0}/>
        <Card label="Value with Upgrade"  value={Fmt.currency(inputs.homeValue + resalePremium)} sub="Estimated post-upgrade"        accent="#22c55e" delay={80}/>
        <Card label="Resale Premium"      value={Fmt.currency(resalePremium)}                    sub="7× annual savings multiplier"  accent="#f97316" delay={160}/>
        <Card label="Annual Savings"      value={Fmt.currency(annualSavings)}                    sub="Energy cost reduction"         accent="#6366f1" delay={240}/>
      </CardGrid></div>

      <div><SectionLabel>Property Value Comparison</SectionLabel>
        <BarChart delay={100} rows={[
          { label:"Current Value",           value:inputs.homeValue,                 max:maxVal, display:Fmt.currency(inputs.homeValue),                 color:"#64748b", color2:"#94a3b8" },
          { label:"Estimated with Upgrades", value:inputs.homeValue + resalePremium, max:maxVal, display:Fmt.currency(inputs.homeValue + resalePremium), color:"#6366f1", color2:"#818cf8" },
        ]}/></div>

      <Panel delay={200}>
        <SectionLabel>Full Comparison</SectionLabel>
        <div style={{ overflowX:"auto", marginTop:16 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
                <th style={{ textAlign:"left",  padding:"8px 12px", color:"#475569", fontWeight:600, fontFamily:"Syne" }}>Metric</th>
                <th style={{ textAlign:"right", padding:"8px 12px", color:"#64748b", fontWeight:600 }}>Base</th>
                <th style={{ textAlign:"right", padding:"8px 12px", color:"#6366f1", fontWeight:600 }}>Upgraded</th>
                <th style={{ textAlign:"right", padding:"8px 12px", color:"#22c55e", fontWeight:600 }}>Δ Saving</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Heat Loss (W)",    base.total.toFixed(0),                 upgraded.total.toFixed(0),                 (base.total - upgraded.total).toFixed(0)],
                ["Energy (kWh/yr)", Math.round(base.kWh).toLocaleString(), Math.round(upgraded.kWh).toLocaleString(), Math.round(base.kWh - upgraded.kWh).toLocaleString()],
                ["Heating Cost",    Fmt.currency(base.cost),                Fmt.currency(upgraded.cost),               Fmt.currency(annualSavings)],
                ["Cost/m²/yr",      `$${base.costPerM2.toFixed(1)}`,       `$${upgraded.costPerM2.toFixed(1)}`,       `$${(base.costPerM2 - upgraded.costPerM2).toFixed(1)}`],
                ["Efficiency Grade", base.grade,                            upgraded.grade,                            "↑"],
              ].map(([m,b,u,d],i)=>(
                <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)", background:i%2===0?"rgba(255,255,255,0.01)":"transparent" }}>
                  <td style={{padding:"10px 12px",color:"#94a3b8"}}>{m}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#64748b"}}>{b}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#818cf8"}}>{u}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#22c55e"}}>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop:14, padding:"10px 14px", background:"#0a0f1e", borderRadius:8, fontSize:11, color:"#475569", lineHeight:1.6 }}>
          * Based on 180-day heating season. Resale premium calculated at 7× annual energy savings. Values are estimates for planning purposes only.
        </div>
      </Panel>

      <button onClick={onRunAI} style={{ padding:"14px 32px", background:"linear-gradient(135deg,#1e1040,#312e81,#4f46e5)", border:"1px solid rgba(99,102,241,0.4)", borderRadius:12, color:"#c7d2fe", fontFamily:"Syne", fontWeight:700, fontSize:14, cursor:"pointer", letterSpacing:"0.04em", boxShadow:"0 8px 24px rgba(79,70,229,0.25)" }}>
        🤖 Run AI Price Forecast →
      </button>
    </div>
  );
};

// ── AI Forecast Tab ───────────────────────────────────────────────────────────

const AIForecastTab = ({ ai, inputs, results, onRunAI, onGoToInputs }) => {
  if (ai.status === "idle") return (
    <div style={{ textAlign:"center", padding:"80px 0", color:"#475569" }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🤖</div>
      <div style={{ fontFamily:"Syne", fontSize:20, color:"#94a3b8", marginBottom:10 }}>AI Price Forecast Not Yet Run</div>
      <div style={{ fontSize:14, marginBottom:28, maxWidth:400, margin:"0 auto 28px" }}>Run your analysis first, then request an AI-powered market forecast with 5 and 10-year projections.</div>
      {!results
        ? <button onClick={onGoToInputs} style={{ padding:"12px 28px", background:"#6366f1", border:"none", borderRadius:10, color:"#fff", fontFamily:"Syne", fontWeight:700, cursor:"pointer" }}>Go to Inputs First</button>
        : <button onClick={onRunAI}      style={{ padding:"12px 28px", background:"linear-gradient(135deg,#4f46e5,#6366f1)", border:"none", borderRadius:10, color:"#fff", fontFamily:"Syne", fontWeight:700, cursor:"pointer", boxShadow:"0 8px 24px rgba(99,102,241,0.35)" }}>Generate AI Price Forecast</button>
      }
    </div>
  );

  if (ai.status === "loading") return (
    <div style={{ textAlign:"center", padding:"80px 0" }}>
      <div style={{ width:48, height:48, border:"3px solid #1e2740", borderTop:"3px solid #6366f1", borderRadius:"50%", margin:"0 auto 24px", animation:"spin 1s linear infinite" }}/>
      <div style={{ fontFamily:"Syne", fontSize:16, color:"#818cf8", marginBottom:8 }}>Generating AI Price Forecast</div>
      <div style={{ fontSize:13, color:"#475569", animation:"pulse 2s infinite" }}>Analysing market data for {inputs.region}…</div>
    </div>
  );

  if (ai.status === "error") return (
    <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:12, padding:24, color:"#fca5a5" }}>
      <div style={{ fontFamily:"Syne", fontWeight:700, marginBottom:8 }}>⚠️ Forecast Error</div>
      <div style={{ fontSize:13 }}>{ai.error}</div>
      <button onClick={onRunAI} style={{ marginTop:16, padding:"10px 20px", background:"#ef4444", border:"none", borderRadius:8, color:"#fff", fontFamily:"Syne", fontWeight:700, cursor:"pointer" }}>Retry</button>
    </div>
  );

  const d     = ai.data;
  const base5  = d.forecast5yr          || {};
  const base10 = d.forecast10yr         || {};
  const upg10  = d.forecast10yrUpgraded || {};

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      <Panel delay={0}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16, flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:260 }}>
            <div style={{ fontFamily:"Syne", fontWeight:700, fontSize:16, color:"#e2e8f0", marginBottom:8 }}>{inputs.region} Market Overview</div>
            <div style={{ fontSize:14, color:"#94a3b8", lineHeight:1.7 }}>{d.regionSummary}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12, alignItems:"flex-end" }}>
            <div style={{ padding:"6px 16px", borderRadius:20, background:`${Fmt.trendColor(d.marketTrend)}22`, border:`1px solid ${Fmt.trendColor(d.marketTrend)}55`, color:Fmt.trendColor(d.marketTrend), fontFamily:"Syne", fontWeight:700, fontSize:13 }}>
              {Fmt.trendArrow(d.marketTrend)} {d.marketTrend}
            </div>
            <Card label="Avg Annual Appreciation" value={`${d.avgAnnualAppreciation}%`} sub="Historical trend" accent="#22c55e"/>
          </div>
        </div>
      </Panel>

      <Panel delay={80}>
        <div style={{ fontFamily:"Syne", fontWeight:700, fontSize:14, color:"#e2e8f0", marginBottom:20 }}>Property Value Projections</div>
        <ForecastRow label="5-Year Forecast (Base)"           low={base5.low||0}  mid={base5.mid||0}  high={base5.high||0}  color="#6366f1"/>
        <ForecastRow label="10-Year Forecast (Base)"          low={base10.low||0} mid={base10.mid||0} high={base10.high||0} color="#f97316"/>
        <ForecastRow label="10-Year Forecast (With Upgrades)" low={upg10.low||0}  mid={upg10.mid||0}  high={upg10.high||0}  color="#22c55e"/>
      </Panel>

      <Panel delay={120} style={{ borderLeft:"3px solid #f97316" }}>
        <div style={{ fontFamily:"Syne", fontWeight:700, fontSize:13, color:"#f97316", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Energy Upgrade Premium</div>
        <div style={{ fontFamily:"Syne", fontWeight:800, fontSize:28, color:"#fdba74", marginBottom:8 }}>+{Fmt.currency(d.upgradePremiumDollars)}</div>
        <div style={{ fontSize:13, color:"#94a3b8", lineHeight:1.6 }}>{d.upgradePremiumExplanation}</div>
      </Panel>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <Panel delay={160}>
          <div style={{ fontFamily:"Syne", fontWeight:700, fontSize:13, color:"#e2e8f0", marginBottom:14 }}>📍 Neighbourhood Factors</div>
          {(d.neighbourhoodFactors||[]).map((f,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:13, color:"#94a3b8", marginBottom:8 }}>
              <span style={{ color:"#6366f1", marginTop:1 }}>◆</span> {f}
            </div>
          ))}
        </Panel>
        <Panel delay={180}>
          <div style={{ fontFamily:"Syne", fontWeight:700, fontSize:13, color:"#e2e8f0", marginBottom:14 }}>🏆 Top Upgrade ROI</div>
          {(d.topUpgradeROI||[]).map((u,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <div style={{ fontFamily:"Syne", fontWeight:800, fontSize:20, color:i===0?"#f97316":i===1?"#94a3b8":"#cd7c2f", minWidth:28 }}>#{i+1}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:"#e2e8f0" }}>{u.name} <span style={{color:"#22c55e"}}>({u.roi}% ROI)</span></div>
                <div style={{ fontSize:11, color:"#475569" }}>{u.note}</div>
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <Panel delay={200} style={{ background:"linear-gradient(135deg,rgba(99,102,241,0.08),rgba(79,70,229,0.04))", border:"1px solid rgba(99,102,241,0.2)" }}>
        <div style={{ fontFamily:"Syne", fontWeight:700, fontSize:13, color:"#818cf8", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.07em" }}>💡 Investor Tip</div>
        <div style={{ fontSize:14, color:"#c7d2fe", lineHeight:1.7 }}>{d.investorTip}</div>
      </Panel>

      <Panel delay={220}>
        <div style={{ fontFamily:"Syne", fontWeight:700, fontSize:13, color:"#ef4444", marginBottom:12, textTransform:"uppercase", letterSpacing:"0.07em" }}>⚠️ Risk Factors</div>
        {(d.riskFactors||[]).map((r,i)=>(
          <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:13, color:"#94a3b8", marginBottom:8 }}>
            <span style={{ color:"#ef4444", marginTop:1, fontSize:10 }}>▲</span> {r}
          </div>
        ))}
      </Panel>

      <button onClick={onRunAI} style={{ alignSelf:"flex-start", padding:"10px 24px", background:"transparent", border:"1px solid rgba(99,102,241,0.35)", borderRadius:8, color:"#818cf8", fontFamily:"Syne", fontWeight:700, fontSize:13, cursor:"pointer" }}>
        ↻ Re-run Price Forecast
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────

export default function ThermoValue() {
  const [tab,     setTab]     = useState("inputs");
  const [inputs,  setInputs]  = useState(DEFAULT_INPUTS);
  const [results, setResults] = useState(null);
  const [ai,      setAi]      = useState({ status:"idle", data:null, error:null });

  const set = (k, v) => setInputs(p => ({ ...p, [k]: v }));
  const num = (k, v) => set(k, parseFloat(v) || 0);

  const handleRunAnalysis = () => {
    setResults(AnalysisEngine.run(inputs));
    setTab("analysis");
  };

  const handleRunAI = async () => {
    if (!results) return;
    setAi({ status:"loading", data:null, error:null });
    setTab("ai");
    try {
      const data = await ForecastService.run(inputs, results);
      setAi({ status:"done", data, error:null });
    } catch (e) {
      setAi({ status:"error", data:null, error:e.message });
    }
  };

  const tabStyle = t => ({
    padding:"10px 22px", border:"none", cursor:"pointer", borderRadius:8,
    fontFamily:"Syne", fontWeight:700, fontSize:13, letterSpacing:"0.04em", transition:"all 0.2s",
    background: tab===t ? "linear-gradient(135deg,#4f46e5,#6366f1)" : "transparent",
    color:      tab===t ? "#fff" : "#64748b",
    boxShadow:  tab===t ? "0 4px 16px rgba(99,102,241,0.3)" : "none",
  });

  return (
    <>
      <FontLink/>
      <GlobalStyles/>
      <div style={{ minHeight:"100vh", background:"#060912" }}>

        <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(6,9,18,0.85)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(99,102,241,0.12)", padding:"0 24px" }}>
          <div style={{ maxWidth:1100, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:64 }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <Logo/>
              <div>
                <div style={{ fontFamily:"Syne", fontWeight:800, fontSize:20, lineHeight:1, letterSpacing:"-0.02em" }}>
                  <span style={{ color:"#e2e8f0" }}>Thermo</span>
                  <span style={{ background:"linear-gradient(90deg,#f97316,#ef4444,#6366f1)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Value</span>
                </div>
                <div style={{ fontSize:10, color:"#475569", fontWeight:500, letterSpacing:"0.06em", textTransform:"uppercase" }}>Energy & Resale Intelligence</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.25)", borderRadius:20, padding:"6px 14px" }}>
              <span style={{ fontSize:13 }}>🤖</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#818cf8", fontFamily:"Syne" }}>AI-Powered Price Forecasting</span>
            </div>
          </div>
        </header>

        <div style={{ background:"rgba(99,102,241,0.06)", borderBottom:"1px solid rgba(99,102,241,0.1)", padding:"10px 24px", textAlign:"center" }}>
          <span style={{ fontSize:13, color:"#64748b" }}>Analyse building heat loss, calculate energy costs, and forecast resale value impact</span>
        </div>

        <div style={{ maxWidth:1100, margin:"0 auto", padding:"20px 24px 0" }}>
          <div style={{ display:"flex", gap:6, background:"#0a0f1e", borderRadius:12, padding:5, border:"1px solid rgba(255,255,255,0.05)", width:"fit-content" }}>
            {[["inputs","⚙️ Inputs"],["analysis","📊 Analysis"],["ai","🤖 AI Price Forecast"]].map(([k,lbl])=>(
              <button key={k} style={tabStyle(k)} onClick={()=>setTab(k)}>{lbl}</button>
            ))}
          </div>
        </div>

        <main style={{ maxWidth:1100, margin:"0 auto", padding:"24px 24px 60px" }}>
          {tab==="inputs"   && <InputsTab     inputs={inputs} set={set} num={num} onRunAnalysis={handleRunAnalysis}/>}
          {tab==="analysis" && <AnalysisTab   results={results} inputs={inputs} onRunAI={handleRunAI} onGoToInputs={()=>setTab("inputs")}/>}
          {tab==="ai"       && <AIForecastTab ai={ai} inputs={inputs} results={results} onRunAI={handleRunAI} onGoToInputs={()=>setTab("inputs")}/>}
        </main>

        <footer style={{ borderTop:"1px solid rgba(255,255,255,0.04)", padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:"#334155" }}>Made by Dylan Tailor</span>
          <span style={{ fontFamily:"Syne", fontWeight:700, fontSize:11, color:"#1e2740", letterSpacing:"0.05em" }}>THERMOVALUE</span>
        </footer>
      </div>
    </>
  );
}
