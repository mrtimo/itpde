// ─────────────────────────────────────────────────────────────────────────────
// Shared UI kit for the ITPD-E dashboards. Dashboard components can only import
// React and @malloyyo/dashboard, so dashboard_src/build.py inlines this file at
// the top of each dashboards/<name>.jsx. Edit here, then run the build script.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { VegaChart, Range, useGiven, useOptions, useQuery, useUrlState, filters } from "@malloyyo/dashboard";

// ── Palette (validated with the dataviz validator, light + dark) ────────────
const PAL = {
  light: {
    A: "#2a78d6", B: "#eb6834",
    sectors: { Agriculture: "#1baf7a", "Mining and Energy": "#eda100", Manufacturing: "#e87ba4", Services: "#4a3aa7" },
    regions: { Africa: "#1baf7a", Americas: "#4a3aa7", Asia: "#eda100", Europe: "#e87ba4", Oceania: "#008300", Other: "#b5b3ab" },
    ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", surface: "#fcfcfb",
    good: "#006300", bad: "#d03b3b",
    seq: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  },
  dark: {
    A: "#3987e5", B: "#d95926",
    sectors: { Agriculture: "#199e70", "Mining and Energy": "#c98500", Manufacturing: "#d55181", Services: "#9085e9" },
    regions: { Africa: "#199e70", Americas: "#9085e9", Asia: "#c98500", Europe: "#d55181", Oceania: "#008300", Other: "#5d5c57" },
    ink: "#ffffff", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835", surface: "#1a1a19",
    good: "#0ca30c", bad: "#e66767",
    seq: ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4"],
  },
};
const SECTORS = ["Agriculture", "Mining and Energy", "Manufacturing", "Services"];
const REGIONS = ["Africa", "Americas", "Asia", "Europe", "Oceania", "Other"];

function useDark() {
  const q = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const [dark, setDark] = useState(q ? q.matches : false);
  useEffect(() => {
    if (!q) return undefined;
    const on = (e) => setDark(e.matches);
    q.addEventListener ? q.addEventListener("change", on) : q.addListener(on);
    return () => (q.removeEventListener ? q.removeEventListener("change", on) : q.removeListener(on));
  }, []);
  return dark;
}
function usePalette() {
  return useDark() ? PAL.dark : PAL.light;
}

// ── Formatting ───────────────────────────────────────────────────────────────
// Every dashboard query returns money in millions of US dollars (usd_m).
function fmtUSD(m, digits) {
  if (m == null || isNaN(m)) return "–";
  const a = Math.abs(m);
  const s = m < 0 ? "−" : "";
  const d = digits ?? (a >= 1e6 ? 2 : 1);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(d)}T`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : d)}B`;
  if (a >= 1) return `${s}$${a.toFixed(a >= 100 ? 0 : d)}M`;
  if (a > 0) return `${s}$${Math.round(a * 1000)}K`;
  return "$0";
}
const fmtPct = (x, d = 1) => (x == null || isNaN(x) ? "–" : `${(x * 100).toFixed(d)}%`);
const fmtNum = (x) => (x == null || isNaN(x) ? "–" : Math.round(x).toLocaleString("en-US"));
// ITPD-E services industries carry a numeric prefix ("163 Other business services").
const cleanIndustry = (s) => String(s ?? "").replace(/^\d+\s+/, "");
// A filter<string> given holds a filter EXPRESSION; unwrap it to the picked value.
function pickedValue(v) {
  if (v == null || v === "") return "";
  const vals = filters.values(String(v));
  return vals && vals.length ? vals[0] : String(v);
}
const cagr = (first, last, years) =>
  first > 0 && last > 0 && years > 0 ? Math.pow(last / first, 1 / years) - 1 : null;

// ── Styles ───────────────────────────────────────────────────────────────────
const CSS = `
.tx{--bg:#f4f3ef;--card:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--line:rgba(11,11,11,.09);
  --hero1:#0b1d33;--hero2:#123a63;--chip:#eceae4;--A:#2a78d6;--B:#eb6834;--good:#006300;--bad:#c22f2f;
  --shadow:0 1px 2px rgba(16,24,40,.05),0 4px 16px rgba(16,24,40,.06);
  --dash-accent:#2a78d6;--dash-radius:10px;
  font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);min-height:100vh}
@media (prefers-color-scheme: dark){
  .tx{--bg:#0d0d0d;--card:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--muted:#9a988f;--line:rgba(255,255,255,.10);
    --hero1:#07111f;--hero2:#0f2c4b;--chip:#26262a;--A:#3987e5;--B:#d95926;--good:#0ca30c;--bad:#e66767;
    --shadow:0 1px 2px rgba(0,0,0,.4);--dash-accent:#3987e5}
}
.tx *{box-sizing:border-box}
.tx-hero{background:radial-gradient(1200px 400px at 85% -10%,rgba(57,135,229,.35),transparent 60%),
  radial-gradient(900px 380px at 5% 120%,rgba(235,104,52,.22),transparent 60%),
  linear-gradient(135deg,var(--hero1),var(--hero2));color:#fff;padding:28px 32px 26px;position:relative;overflow:hidden}
.tx-hero:after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.08) 1px,transparent 1px);
  background-size:22px 22px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.6),transparent 85%);pointer-events:none}
.tx-hero>*{position:relative;z-index:1}
.tx-eyebrow{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:#9cc3f0;font-weight:600}
.tx-title{font-size:30px;line-height:1.15;font-weight:700;margin:6px 0 6px;letter-spacing:-.01em}
.tx-sub{color:#c9d6e6;max-width:820px;margin:0}
.tx-controls{margin-top:20px;background:rgba(255,255,255,.96);color:#0b0b0b;border-radius:14px;padding:14px 16px;
  display:flex;flex-wrap:wrap;gap:14px 18px;align-items:flex-end;box-shadow:0 10px 30px rgba(0,0,0,.25)}
@media (prefers-color-scheme: dark){.tx-controls{background:rgba(26,26,25,.97);color:#fff}}
.tx-field{display:flex;flex-direction:column;gap:5px;min-width:150px}
.tx-field label{font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:6px}
.tx-field select{appearance:none;-webkit-appearance:none;font:inherit;font-size:14.5px;font-weight:550;color:inherit;
  background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23898781' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center;
  border:1px solid var(--line);border-radius:10px;padding:9px 32px 9px 12px;width:210px;text-overflow:ellipsis;cursor:pointer}
.tx-field select:hover{border-color:var(--muted)}
.tx-field select:focus{outline:2px solid var(--dash-accent);outline-offset:1px}
.tx-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.tx-swap{border:1px solid var(--line);background:var(--card);color:inherit;border-radius:999px;width:38px;height:38px;cursor:pointer;
  font-size:17px;display:grid;place-items:center;transition:transform .2s;margin-bottom:1px}
.tx-swap:hover{transform:rotate(180deg)}
.tx-range{min-width:230px;flex:1;max-width:330px}
.tx-range>div>div:first-child{font-size:11px!important;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)!important}
.tx-try{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:#c9d6e6;font-size:12.5px}
.tx-try button{font:inherit;font-size:12.5px;color:#fff;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);
  border-radius:999px;padding:4px 11px;cursor:pointer}
.tx-try button:hover{background:rgba(255,255,255,.2)}
.tx-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.tx-chip{font-size:12px;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.16);color:#e6eef8}
.tx-body{padding:22px 32px 40px;max-width:1440px;margin:0 auto}
.tx-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:18px}
.tx-card{grid-column:span 6;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px 16px;box-shadow:var(--shadow);min-width:0}
.tx-card.w12{grid-column:span 12}.tx-card.w8{grid-column:span 8}.tx-card.w4{grid-column:span 4}.tx-card.w7{grid-column:span 7}.tx-card.w5{grid-column:span 5}
@media (max-width:1000px){.tx-card,.tx-card.w8,.tx-card.w4,.tx-card.w7,.tx-card.w5{grid-column:span 12}}
.tx-card h3{margin:0;font-size:15.5px;font-weight:650;letter-spacing:-.005em}
.tx-card .tx-cardsub{margin:3px 0 12px;color:var(--ink2);font-size:13px}
.tx-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:18px}
.tx-kpi{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:15px 18px;box-shadow:var(--shadow);position:relative;overflow:hidden}
.tx-kpi:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--accent,transparent)}
.tx-kpi .l{font-size:12px;color:var(--ink2);font-weight:550;display:flex;gap:6px;align-items:center}
.tx-kpi .v{font-size:27px;font-weight:700;letter-spacing:-.02em;margin-top:4px}
.tx-kpi .s{font-size:12.5px;color:var(--muted);margin-top:2px}
.tx-up{color:var(--good);font-weight:600}.tx-down{color:var(--bad);font-weight:600}
.tx-explain{margin-top:12px;display:flex;gap:10px;padding:10px 12px;border-radius:12px;background:var(--chip);color:var(--ink2);font-size:12.8px}
.tx-explain b{color:var(--ink)}
.tx-explain .i{flex:none;width:20px;height:20px;border-radius:50%;background:var(--dash-accent);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700;font-style:normal}
.tx-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--ink2);margin:-4px 0 6px}
.tx-legend span{display:inline-flex;align-items:center;gap:6px}
.tx-bars{display:flex;flex-direction:column;gap:7px}
.tx-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:5px 8px;margin:0 -8px;border-radius:9px;cursor:default}
.tx-bar.click{cursor:pointer}.tx-bar.click:hover{background:var(--chip)}
.tx-bar .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13.2px}
.tx-bar .x{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;text-align:right}
.tx-bar .t{grid-column:1/3;height:7px;border-radius:4px;background:var(--chip);overflow:hidden}
.tx-bar .t i{display:block;height:100%;border-radius:4px}
.tx-bar .m{font-size:11.5px;color:var(--muted);font-weight:500;margin-left:6px}
.tx-tag{font-size:10.5px;padding:1px 7px;border-radius:999px;border:1px solid var(--line);color:var(--ink2);margin-left:6px;white-space:nowrap}
.tx-skel{border-radius:12px;background:linear-gradient(90deg,var(--chip) 0%,rgba(127,127,127,.08) 50%,var(--chip) 100%);background-size:200% 100%;animation:txs 1.2s infinite}
@keyframes txs{0%{background-position:200% 0}100%{background-position:-200% 0}}
.tx-empty{padding:28px;text-align:center;color:var(--muted)}
.tx-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tx-fact{border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.tx-fact .k{font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.tx-fact .v{font-size:16px;font-weight:650;margin-top:2px}
.tx-yes{color:var(--good)}.tx-no{color:var(--muted)}
.tx-stat{display:flex;gap:22px;flex-wrap:wrap;margin:2px 0 10px}
.tx-stat div{font-size:12px;color:var(--ink2)}.tx-stat b{display:block;font-size:20px;color:var(--ink);letter-spacing:-.01em}
.tx-foot{margin-top:26px;color:var(--muted);font-size:12px;line-height:1.6;border-top:1px solid var(--line);padding-top:14px}
.tx-two{display:grid;grid-template-columns:1fr 1fr;gap:22px}
@media (max-width:800px){.tx-two{grid-template-columns:1fr}.tx-facts{grid-template-columns:1fr}}
.tx-colhead{font-size:12.5px;font-weight:650;margin-bottom:8px;display:flex;align-items:center;gap:7px}
.tx-heat{width:100%;border-collapse:separate;border-spacing:3px;font-size:12px}
.tx-heat th{font-weight:600;color:var(--ink2);text-align:left;padding:4px 6px;font-size:11.5px}
.tx-heat td{text-align:center;padding:9px 4px;border-radius:7px;font-weight:600;font-variant-numeric:tabular-nums}
`;

// ── Layout pieces ────────────────────────────────────────────────────────────
function Shell({ children }) {
  return (
    <div className="tx">
      <style>{CSS}</style>
      {children}
    </div>
  );
}
function Hero({ eyebrow, title, sub, children }) {
  return (
    <header className="tx-hero">
      <div className="tx-eyebrow">{eyebrow}</div>
      <h1 className="tx-title">{title}</h1>
      <p className="tx-sub">{sub}</p>
      {children}
    </header>
  );
}
function Card({ w = 6, title, sub, children, style }) {
  return (
    <section className={`tx-card w${w}`} style={style}>
      {title && <h3>{title}</h3>}
      {sub ? <p className="tx-cardsub">{sub}</p> : <div style={{ height: 10 }} />}
      {children}
    </section>
  );
}
function Kpi({ label, value, sub, accent, dot }) {
  return (
    <div className="tx-kpi" style={{ "--accent": accent }}>
      <div className="l">
        {dot && <span className="tx-dot" style={{ background: dot }} />}
        {label}
      </div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}
function Explain({ title, children }) {
  return (
    <div className="tx-explain">
      <i className="i">i</i>
      <div>
        {title && <b>{title} </b>}
        {children}
      </div>
    </div>
  );
}
function Skel({ h = 260 }) {
  return <div className="tx-skel" style={{ height: h }} />;
}
function Empty({ children }) {
  return <div className="tx-empty">{children || "No trade recorded for this selection."}</div>;
}
function Legend({ items }) {
  return (
    <div className="tx-legend">
      {items.map((it) => (
        <span key={it.label}>
          <span className="tx-dot" style={{ background: it.color, borderRadius: it.square ? 3 : "50%" }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
function Delta({ value, suffix = "", invert }) {
  if (value == null || isNaN(value)) return null;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={good ? "tx-up" : "tx-down"}>
      {up ? "▲" : "▼"} {Math.abs(value * 100).toFixed(1)}%{suffix}
    </span>
  );
}

// Horizontal bar list (HTML, so rows can be clicked to drive a given).
function BarList({ rows, color, onPick, pickHint, max }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 0);
  return (
    <div className="tx-bars">
      {rows.map((r) => (
        <div
          key={r.key ?? r.label}
          className={`tx-bar${onPick ? " click" : ""}`}
          onClick={onPick ? () => onPick(r) : undefined}
          title={onPick ? pickHint?.(r) : undefined}
        >
          <div className="n">
            {r.label}
            {r.tag && <span className="tx-tag">{r.tag}</span>}
            {r.meta && <span className="m">{r.meta}</span>}
          </div>
          <div className="x">{r.display}</div>
          <div className="t">
            <i style={{ width: `${top > 0 ? Math.max(1.5, (r.value / top) * 100) : 0}%`, background: r.color || color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────
// A dropdown bound to a filter<string> given, fed by the given's suggest query.
// allowAll adds an "All" (empty filter) option; country pickers omit it.
function GivenSelect({ given, label, dot, allowAll, allLabel = "All", format }) {
  const { value, set } = useGiven(given);
  const { options } = useOptions(given);
  const current = pickedValue(value);
  const opts = (options || []).map((o) => (typeof o === "object" ? (o.text ?? o.value) : String(o)));
  if (current && !opts.includes(current)) opts.unshift(current);
  return (
    <div className="tx-field">
      <label>
        {dot && <span className="tx-dot" style={{ background: dot }} />}
        {label}
      </label>
      <select value={current} onChange={(e) => set(e.target.value ? filters.oneOf(e.target.value) : "")}>
        {allowAll && <option value="">{allLabel}</option>}
        {opts.map((o) => (
          <option key={o} value={o}>
            {format ? format(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}
// Sector + industry pair: the industry list narrows to the chosen sector, and a
// sector change clears an industry that no longer belongs to it.
function SectorIndustry({ prefix }) {
  const sector = useGiven(`${prefix}_SECTOR`);
  const industry = useGiven(`${prefix}_INDUSTRY`);
  const [prev, setPrev] = useState(sector.value);
  useEffect(() => {
    if (sector.value !== prev) {
      setPrev(sector.value);
      if (industry.value) industry.set("");
    }
  }, [sector.value]);
  return (
    <>
      <GivenSelect given={`${prefix}_SECTOR`} label="Sector" allowAll allLabel="All sectors" />
      <GivenSelect given={`${prefix}_INDUSTRY`} label="Industry (optional)" allowAll allLabel="All industries" format={cleanIndustry} />
    </>
  );
}
function YearRange({ prefix }) {
  return (
    <div className="tx-range">
      <Range given={`${prefix}_YEAR_RANGE`} label="Years" />
    </div>
  );
}

// ── Vega-Lite helpers ────────────────────────────────────────────────────────
function vegaConfig(p) {
  return {
    background: null,
    font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    view: { stroke: null },
    axis: {
      labelColor: p.muted, titleColor: p.ink2, gridColor: p.grid, domainColor: p.axis, tickColor: p.axis,
      labelFontSize: 11.5, titleFontSize: 11.5, titleFontWeight: 500, labelPadding: 6, gridWidth: 1,
    },
    axisX: { grid: false, tickCount: 8 },
    axisY: { domain: false, ticks: false, tickCount: 5 },
    legend: { disable: true },
    text: { color: p.ink2, fontSize: 11.5 },
  };
}
// Axis label expression: billions of USD in, "$1.2T" / "$350B" / "$4B" out.
const BN_LABEL =
  "datum.value >= 1000 || datum.value <= -1000 ? (datum.value < 0 ? '−' : '') + '$' + format(abs(datum.value) / 1000, '.1~f') + 'T' : (datum.value < 0 ? '−' : '') + '$' + format(abs(datum.value), datum.value != 0 && abs(datum.value) < 10 ? '.1~f' : '.0f') + 'B'";
// Same, for tooltips/labels from a field named in `f` (billions).
const bnText = (f) =>
  `(abs(datum.${f}) >= 1000 ? '$' + format(datum.${f} / 1000, '.2~f') + 'T' : abs(datum.${f}) >= 1 ? '$' + format(datum.${f}, '.1~f') + 'B' : '$' + format(datum.${f} * 1000, '.0f') + 'M')`;

// Multi-series line chart with a hover crosshair that prints each series' value.
// rows: [{year, key, label, v}] — v already in the unit `fmt` expects.
function lineSpec({ p, keys, colors, labels, yTitle, yFormat, valueText, height = 260, yZero = true }) {
  const color = { field: "key", type: "nominal", scale: { domain: keys, range: colors }, legend: null };
  return {
    height,
    config: vegaConfig(p),
    encoding: {
      x: { field: "year", type: "quantitative", title: null, axis: { format: "d", tickMinStep: 1 }, scale: { nice: false } },
    },
    layer: [
      {
        mark: { type: "line", strokeWidth: 2.25, interpolate: "monotone", strokeCap: "round" },
        encoding: {
          y: { field: "v", type: "quantitative", title: yTitle, scale: { zero: yZero }, axis: yFormat ? { labelExpr: yFormat } : { format: "~s" } },
          color,
        },
      },
      {
        params: [{ name: "hov", select: { type: "point", fields: ["year"], nearest: true, on: "pointermove", clear: "pointerout" } }],
        mark: { type: "rule", strokeWidth: 1, color: p.axis },
        encoding: { opacity: { condition: { param: "hov", empty: false, value: 1 }, value: 0 } },
      },
      {
        transform: [{ filter: { param: "hov", empty: false } }],
        mark: { type: "point", filled: true, size: 70, stroke: p.surface, strokeWidth: 2 },
        encoding: { y: { field: "v", type: "quantitative" }, color },
      },
      {
        transform: [
          { filter: { param: "hov", empty: false } },
          { calculate: valueText, as: "txt" },
        ],
        mark: { type: "text", align: "left", dx: 9, fontWeight: 650, fontSize: 12, color: p.ink },
        encoding: {
          y: { field: "v", type: "quantitative" },
          text: { field: "txt" },
        },
      },
      {
        transform: [{ filter: { param: "hov", empty: false } }, { aggregate: [{ op: "count", as: "n" }], groupby: ["year"] }],
        mark: { type: "text", y: -6, fontWeight: 700, fontSize: 12, color: p.ink },
        encoding: { text: { field: "year", type: "quantitative", format: "d" } },
      },
    ],
  };
}

// Run a named query in this dashboard file with ONLY the givens its tab uses,
// so changing a filter on one tab never re-runs another tab's queries.
function pickGivens(givens, keys) {
  const out = {};
  for (const k of keys) if (givens[k] !== undefined) out[k] = givens[k];
  return out;
}
function useRows(query, givens) {
  return useQuery({ query, givens });
}
// Flatten a one-row-per-year result with a nested array into flat rows.
function unnest(rows, key) {
  const out = [];
  for (const r of rows) for (const x of r[key] || []) out.push({ ...x, year: r.year });
  return out;
}
// Latest year present in a row set (optionally capped, e.g. DGD ends in 2019).
function latestYear(rows, cap) {
  let y = null;
  for (const r of rows) if ((cap == null || r.year <= cap) && (y == null || r.year > y)) y = r.year;
  return y;
}
function firstYear(rows) {
  let y = null;
  for (const r of rows) if (y == null || r.year < y) y = r.year;
  return y;
}

function Footer() {
  return (
    <footer className="tx-foot">
      <b>Data:</b> USITC International Trade and Production Database for Estimation (ITPD-E), release 2025 — trade in current US
      dollars, 170 industries, 1986–2023, including domestic sales (excluded from the cross-border figures here). Gravity
      variables: USITC Dynamic Gravity Dataset 2.1 (1986–2019). Regions: UN M49. Income groups: World Bank. Coverage: agriculture
      from 1986, manufacturing and mining & energy from 1988, services from 2000; services methodology changes in 2004 and 2010
      cause visible jumps. Domestic (home-market) sales are complete only through 2021.
    </footer>
  );
}
