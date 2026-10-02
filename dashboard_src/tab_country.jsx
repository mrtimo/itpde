// ── Country Trade Profile ────────────────────────────────────────────────────
const TRY_COUNTRIES = ["Germany", "China", "Mexico", "Vietnam", "Nigeria", "Chile", "India", "Australia", "Korea, South"];

// Ordinary least squares for y = a + b1·x1 + b2·x2 (normal equations, 3×3 solve).
function ols2(rows) {
  const n = rows.length;
  if (n < 8) return null;
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const t = [0, 0, 0];
  for (const r of rows) {
    const x = [1, r.x1, r.x2];
    for (let i = 0; i < 3; i++) {
      t[i] += x[i] * r.y;
      for (let j = 0; j < 3; j++) S[i][j] += x[i] * x[j];
    }
  }
  // Gaussian elimination
  const M = S.map((row, i) => [...row, t[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const beta = M.map((row, i) => row[3] / row[i]);
  const ybar = rows.reduce((s, r) => s + r.y, 0) / n;
  let ssr = 0,
    sst = 0;
  for (const r of rows) {
    const yh = beta[0] + beta[1] * r.x1 + beta[2] * r.x2;
    ssr += (r.y - yh) ** 2;
    sst += (r.y - ybar) ** 2;
  }
  return { a: beta[0], bGdp: beta[1], bDist: beta[2], r2: sst > 0 ? 1 - ssr / sst : null, n };
}

// ── Trade with partners over time (One country tab) ──────────────────────────
// Lines for a group of partners: top 10 / 11–20 / 21–30 overall, or the top 10
// within a UN region. One hue for all lines (10 series is too many to tell apart
// by color); the hovered partner is highlighted, others fade, and every line
// carries a name label at its end. The side list doubles as a legend: hover a
// name to highlight its line, click it to open Two countries for the pair.
const PT_GROUPS = [
  { id: "top10", label: "Top 10", lo: 0, hi: 10 },
  { id: "top20", label: "11–20", lo: 10, hi: 20 },
  { id: "top30", label: "21–30", lo: 20, hi: 30 },
];
const PT_REGIONS = ["Africa", "Americas", "Asia", "Europe", "Oceania"];
const PT_MEASURES = [
  { id: "total", label: "Two-way trade", pick: (r) => (r.exports_m || 0) + (r.imports_m || 0), tot: (t) => (t.exports_m || 0) + (t.imports_m || 0) },
  { id: "exports", label: "Exports", pick: (r) => r.exports_m || 0, tot: (t) => t.exports_m || 0 },
  { id: "imports", label: "Imports", pick: (r) => r.imports_m || 0, tot: (t) => t.imports_m || 0 },
];

const PT_CSS = `
.pt-bar{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin:2px 0 12px}
.pt-seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:2px;gap:2px;background:var(--card)}
.pt-seg button{font:inherit;font-size:12.5px;border:0;background:transparent;color:var(--ink2);padding:5px 11px;border-radius:999px;cursor:pointer;white-space:nowrap}
.pt-seg button:hover{color:var(--ink);background:var(--chip)}
.pt-seg button.on{background:var(--dash-accent);color:#fff;font-weight:600}
.pt-lbl{font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-right:2px}
.pt-wrap{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:18px;align-items:start}
@media (max-width:900px){.pt-wrap{grid-template-columns:1fr}}
.pt-list{display:flex;flex-direction:column;gap:2px}
.pt-row{display:grid;grid-template-columns:20px minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:6px 8px;border-radius:9px;cursor:pointer}
.pt-row:hover,.pt-row.hl{background:var(--chip)}
.pt-row .rk{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.pt-row .nm{font-size:13.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pt-row .vl{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;text-align:right}
.pt-row .sh{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:40px;text-align:right}
.pt-note{font-size:11.5px;color:var(--muted);padding:6px 8px 0}
`;

function PartnerTrends({ rows, totals, name, p, onCompare, loading }) {
  const [group, setGroup] = useUrlState("cpg", "top10");
  const [measure, setMeasure] = useUrlState("cpm", "total");
  const [scale, setScale] = useUrlState("cps", "usd");
  const [hl, setHl] = useState("");
  const M = PT_MEASURES.find((m) => m.id === measure) || PT_MEASURES[0];
  const share = scale === "share";

  const latest = latestYear(rows);
  const first = firstYear(rows);
  const totByYear = useMemo(() => new Map(totals.map((t) => [t.year, M.tot(t)])), [totals, M]);

  // Rank partners by the chosen measure in the latest year, then pick the group.
  const chosen = useMemo(() => {
    const now = rows.filter((r) => r.year === latest && M.pick(r) > 0);
    const pool = PT_REGIONS.includes(group) ? now.filter((r) => r.partner_region === group) : now;
    const ranked = pool.sort((a, b) => M.pick(b) - M.pick(a));
    const g = PT_GROUPS.find((x) => x.id === group);
    const slice = g ? ranked.slice(g.lo, g.hi) : ranked.slice(0, 10);
    const offset = g ? g.lo : 0;
    const tot = totByYear.get(latest) || 0;
    return slice.map((r, i) => ({ partner: r.partner, region: r.partner_region, rank: offset + i + 1, value: M.pick(r), sh: tot > 0 ? M.pick(r) / tot : null }));
  }, [rows, latest, group, M, totByYear]);

  const data = useMemo(() => {
    const set = new Map(chosen.map((c) => [c.partner, c.rank]));
    const out = [];
    for (const r of rows) {
      if (!set.has(r.partner)) continue;
      const v = M.pick(r);
      const tot = totByYear.get(r.year) || 0;
      out.push({
        year: r.year, partner: r.partner, rank: set.get(r.partner),
        v: share ? (tot > 0 ? v / tot : null) : v / 1000,
        hl: hl === r.partner, anyhl: !!hl,
      });
    }
    const clean = out.filter((d) => d.v != null).sort((a, b) => a.rank - b.rank || a.year - b.year);
    // End labels: one per partner at its last year, nudged apart so names never overlap.
    const last = new Map();
    for (const d of clean) if (!last.has(d.partner) || d.year > last.get(d.partner).year) last.set(d.partner, d);
    const ends = [...last.values()].sort((a, b) => b.v - a.v);
    const maxV = Math.max(...clean.map((d) => d.v), 0);
    const gap = maxV * 0.05;
    let prev = Infinity;
    for (const e of ends) {
      e.labelV = Math.min(e.v, prev - gap);
      prev = e.labelV;
    }
    return clean;
  }, [rows, chosen, M, share, hl, totByYear]);

  const spec = useMemo(() => {
    const valueTxt = share ? "format(datum.v, '.1%')" : bnText("v");
    const flip = latest && first ? (first + latest) / 2 : 2012;
    const on = (v, off) => ({ condition: [{ param: "lp", empty: false, value: v }, { test: "datum.hl", value: v }], value: off });
    return {
      height: 400,
      config: vegaConfig(p),
      encoding: {
        x: { field: "year", type: "quantitative", title: null, axis: { format: "d", tickMinStep: 1 }, scale: { nice: false } },
        y: { field: "v", type: "quantitative", title: null, axis: share ? { format: ".0%" } : { labelExpr: BN_LABEL } },
      },
      layer: [
        {
          mark: { type: "line", interpolate: "monotone", strokeCap: "round" },
          encoding: {
            detail: { field: "partner" },
            color: on(p.B, p.A),
            strokeWidth: on(3.5, 1.8),
            opacity: { condition: [{ param: "lp", empty: false, value: 1 }, { test: "datum.hl", value: 1 }], value: { expr: "length(data('lp_store')) || datum.anyhl ? 0.18 : 0.7" } },
          },
        },
        {
          // Invisible hit targets: the nearest point picks the partner (and year).
          params: [
            { name: "lp", select: { type: "point", fields: ["partner"], nearest: true, on: "pointermove", clear: "pointerout" } },
            { name: "ly", select: { type: "point", fields: ["partner", "year"], nearest: true, on: "pointermove", clear: "pointerout" } },
          ],
          mark: { type: "point", opacity: 0, size: 100 },
        },
        {
          transform: [{ filter: { param: "ly", empty: false } }],
          mark: { type: "point", filled: true, size: 80, color: p.B, stroke: p.surface, strokeWidth: 2 },
        },
        // End-of-line name labels (latest year).
        {
          transform: [{ filter: "isValid(datum.labelV)" }],
          mark: { type: "text", align: "left", dx: 6, fontSize: 11, clip: false },
          encoding: {
            y: { field: "labelV", type: "quantitative" },
            text: { field: "partner" },
            color: on(p.ink, p.ink2),
            fontWeight: { condition: [{ param: "lp", empty: false, value: 700 }, { test: "datum.hl", value: 700 }], value: 500 },
            opacity: { condition: [{ param: "lp", empty: false, value: 1 }, { test: "datum.hl", value: 1 }], value: { expr: "length(data('lp_store')) || datum.anyhl ? 0.35 : 0.9" } },
          },
        },
        // Hover readout: "Canada · $348B · 2023" (a halo pass, then the text).
        ...[{ stroke: p.surface, strokeWidth: 5, strokeJoin: "round" }, {}].map((halo) => ({
          transform: [{ filter: { param: "ly", empty: false } }, { calculate: `datum.partner + ' · ' + ${valueTxt} + ' · ' + datum.year`, as: "txt" }],
          mark: {
            type: "text", dy: -14, fontSize: 13, fontWeight: 700, color: p.ink, clip: true, ...halo,
            align: { expr: `datum.year > ${flip} ? 'right' : 'left'` },
            dx: { expr: `datum.year > ${flip} ? -10 : 10` },
          },
          encoding: { text: { field: "txt" } },
        })),
      ],
    };
  }, [p, share, latest, first]);

  const groupLabel = PT_REGIONS.includes(group)
    ? `top 10 partners in ${group}`
    : group === "top10" ? "top 10 partners" : `partners ranked ${(PT_GROUPS.find((g) => g.id === group) || PT_GROUPS[0]).label}`;
  const seg = (items, value, set) => (
    <div className="pt-seg">
      {items.map((it) => (
        <button key={it.id} className={value === it.id ? "on" : ""} onClick={() => set(it.id)} aria-pressed={value === it.id}>
          {it.label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <style>{PT_CSS}</style>
      <div className="pt-bar">
        <span>
          <span className="pt-lbl">Partners</span> {seg(PT_GROUPS, group, setGroup)}
        </span>
        <span>
          <span className="pt-lbl">Region</span> {seg(PT_REGIONS.map((r) => ({ id: r, label: r })), group, setGroup)}
        </span>
        <span>
          <span className="pt-lbl">Measure</span> {seg(PT_MEASURES, measure, setMeasure)}
        </span>
        <span>
          <span className="pt-lbl">Show</span> {seg([{ id: "usd", label: "$ billions" }, { id: "share", label: `% of ${name}'s total` }], scale, setScale)}
        </span>
      </div>
      {loading && !rows.length ? (
        <Skel h={380} />
      ) : !chosen.length ? (
        <Empty>No partners with trade in this group for the selected years and filters.</Empty>
      ) : (
        <div className="pt-wrap">
          <div onMouseLeave={() => setHl("")}>
            <VegaChart spec={spec} data={data} />
          </div>
          <div className="pt-list" onMouseLeave={() => setHl("")}>
            {chosen.map((c) => (
              <div
                key={c.partner}
                className={`pt-row${hl === c.partner ? " hl" : ""}`}
                onMouseEnter={() => setHl(c.partner)}
                onClick={() => onCompare(name, c.partner)}
                title={`Compare ${name} and ${c.partner} in Two countries`}
              >
                <span className="rk">{c.rank}</span>
                <span className="nm" title={c.region}>
                  {c.partner}
                </span>
                <span className="vl">{fmtUSD(c.value)}</span>
                <span className="sh">{c.sh != null ? fmtPct(c.sh) : ""}</span>
              </div>
            ))}
            <div className="pt-note">
              {M.label} in {latest}, and share of {name}'s total. Click a name to compare the two countries.
            </div>
          </div>
        </div>
      )}
      <Explain title="How to use this:">
        Lines show {M.label.toLowerCase()} with {name}'s {groupLabel} (by {M.label.toLowerCase()} in {latest}). Point at a line (or a name on
        the right) to highlight it; click a name to see what the two countries trade. Switch to <b>% of total</b> to see which
        partners are gaining or losing ground rather than just growing with world trade.
      </Explain>
    </>
  );
}

const C_KEYS = ['COUNTRY', 'C_SECTOR', 'C_INDUSTRY', 'C_YEAR_RANGE'];

function CountryTab({ givens: allGivens, onCompare }) {
  const givens = useMemo(() => pickGivens(allGivens, C_KEYS), [JSON.stringify(pickGivens(allGivens, C_KEYS))]);
  const p = usePalette();
  const C = useGiven("COUNTRY");
  const IND = useGiven("C_INDUSTRY");
  const name = pickedValue(C.value) || "Country";
  const industry = cleanIndustry(pickedValue(givens.C_INDUSTRY));
  const sector = pickedValue(givens.C_SECTOR);
  const selection = industry || sector || "all goods & services";

  const totals = useRows("c_totals_by_year", givens);
  const regions = useRows("c_exports_by_region_year", givens);
  const partnersQ = useRows("c_partners_by_year", givens);
  const indsQ = useRows("c_industries_by_year", givens);
  const partners = useMemo(() => ({ loading: partnersQ.loading, rows: unnest(partnersQ.rows, "partners") }), [partnersQ.rows, partnersQ.loading]);
  const inds = useMemo(() => ({ loading: indsQ.loading, rows: unnest(indsQ.rows, "industries") }), [indsQ.rows, indsQ.loading]);
  const facts = useRows("c_country_facts", givens);
  const f = facts.rows[0];

  const T = totals.rows;
  const L = T.length ? T[T.length - 1] : null;
  const F = T.find((r) => r.exports_m > 0) || null;
  const grow = L && F && L.year > F.year ? cagr(F.exports_m, L.exports_m, L.year - F.year) : null;
  const balance = L ? L.exports_m - L.imports_m : null;
  // ITPD-E R2025 production (domestic sales) data is complete only through 2021;
  // 2022 is partial and 2023 nearly empty, so the openness ratio uses year ≤ 2021.
  const D = [...T].reverse().find((r) => r.year <= 2021 && r.domestic_m > 0) || null;
  const openness = D ? D.exports_m / (D.exports_m + D.domestic_m) : null;

  const lineRows = useMemo(
    () => T.flatMap((r) => [{ year: r.year, key: "X", v: r.exports_m / 1000 }, { year: r.year, key: "M", v: r.imports_m / 1000 }]),
    [T],
  );
  const regionRows = useMemo(() => regions.rows.map((r) => ({ year: r.year, region: r.region, so: REGIONS.indexOf(r.region), v: r.usd_m / 1000 })), [regions.rows]);

  const py = latestYear(partners.rows);
  const pFirst = firstYear(partners.rows);
  const partnersLatest = useMemo(() => partners.rows.filter((r) => r.year === py), [partners.rows, py]);
  const earlyShare = useMemo(() => {
    const rows = partners.rows.filter((r) => r.year === pFirst);
    const tx = rows.reduce((s, r) => s + (r.exports_m || 0), 0);
    const tm = rows.reduce((s, r) => s + (r.imports_m || 0), 0);
    const m = new Map(rows.map((r) => [r.partner, { x: tx > 0 ? r.exports_m / tx : 0, m: tm > 0 ? r.imports_m / tm : 0 }]));
    return m;
  }, [partners.rows, pFirst]);
  const topList = (field) => {
    const tot = partnersLatest.reduce((s, r) => s + (r[field] || 0), 0);
    return partnersLatest
      .filter((r) => r[field] > 0)
      .sort((a, b) => b[field] - a[field])
      .slice(0, 12)
      .map((r) => {
        const sh = tot > 0 ? r[field] / tot : 0;
        const was = earlyShare.get(r.partner)?.[field === "exports_m" ? "x" : "m"];
        const arrow = was == null || py === pFirst ? "" : sh > was + 0.0005 ? ` ▲ from ${fmtPct(was, 0)}` : sh < was - 0.0005 ? ` ▼ from ${fmtPct(was, 0)}` : "";
        return {
          key: r.partner,
          label: r.partner,
          value: r[field],
          display: fmtUSD(r[field]),
          meta: `${fmtPct(sh, 1)}${arrow}`,
          tag: r.partner_region,
          color: p.regions[r.partner_region] || p.regions.Other,
        };
      });
  };

  // Gravity scatter: latest year ≤ 2019 that has distance + GDP data.
  const gYear = useMemo(() => {
    let y = null;
    for (const r of partners.rows) if (r.year <= 2019 && r.distance_km > 0 && r.partner_gdp_bn > 0 && (y == null || r.year > y)) y = r.year;
    return y;
  }, [partners.rows]);
  const gRows = useMemo(
    () =>
      partners.rows
        .filter((r) => r.year === gYear && r.exports_m > 0.05 && r.distance_km > 0 && r.partner_gdp_bn > 0)
        .map((r) => ({ partner: r.partner, x: r.distance_km, y: r.exports_m, gdp: r.partner_gdp_bn, region: r.partner_region || "Other" }))
        .sort((a, b) => b.y - a.y)
        .map((r, i) => ({ ...r, rank: i + 1 })),
    [partners.rows, gYear],
  );
  const fit = useMemo(() => ols2(gRows.map((r) => ({ y: Math.log(r.y), x1: Math.log(r.gdp), x2: Math.log(r.x) }))), [gRows]);
  // Simple power-law fit of exports on distance (log-log OLS) for the grey trend line.
  const gData = useMemo(() => {
    const pts = gRows.map((r) => ({ ...r, kind: "pt" }));
    if (gRows.length < 3) return pts;
    const lx = gRows.map((r) => Math.log(r.x));
    const ly = gRows.map((r) => Math.log(r.y));
    const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
    const my = ly.reduce((a, b) => a + b, 0) / ly.length;
    let sxy = 0, sxx = 0;
    lx.forEach((x, i) => { sxy += (x - mx) * (ly[i] - my); sxx += (x - mx) ** 2; });
    const b = sxx > 0 ? sxy / sxx : 0;
    const a = my - b * mx;
    const lo = Math.min(...lx), hi = Math.max(...lx);
    const line = [0, 1].map((t) => {
      const x = Math.exp(lo + t * (hi - lo));
      return { kind: "fit", x, y: Math.exp(a + b * Math.log(x)) };
    });
    return [...pts, ...line];
  }, [gRows]);

  const indLatestYear = latestYear(inds.rows);
  const indRows = inds.rows.filter((r) => r.year === indLatestYear);
  const indList = (field, color) => {
    const tot = indRows.reduce((s, r) => s + (r[field] || 0), 0);
    return indRows
      .filter((r) => r[field] > 0)
      .sort((a, b) => b[field] - a[field])
      .slice(0, 10)
      .map((r) => ({
        key: r.industry_descr,
        label: cleanIndustry(r.industry_descr),
        value: r[field],
        display: fmtUSD(r[field]),
        meta: tot > 0 ? fmtPct(r[field] / tot, 0) : null,
        tag: r.broad_sector,
        color,
      }));
  };

  const lspec = useMemo(
    () => lineSpec({ p, keys: ["X", "M"], colors: [p.A, p.B], yTitle: null, yFormat: BN_LABEL, valueText: bnText("v"), height: 300 }),
    [p],
  );
  const regSpec = useMemo(
    () => ({
      height: 250,
      config: vegaConfig(p),
      mark: { type: "bar", width: { band: 0.8 }, stroke: p.surface, strokeWidth: 1 },
      encoding: {
        x: { field: "year", type: "ordinal", title: null, axis: { labelAngle: 0, labelExpr: "datum.value % 5 == 0 ? datum.value : ''" } },
        y: { field: "v", type: "quantitative", stack: "normalize", title: null, axis: { format: ".0%" } },
        color: { field: "region", type: "nominal", scale: { domain: REGIONS, range: REGIONS.map((r) => p.regions[r]) }, legend: null },
        order: { field: "so", type: "quantitative", sort: "ascending" },
        tooltip: [
          { field: "year", type: "ordinal", title: "Year" },
          { field: "region", type: "nominal", title: "Destination region" },
          { field: "v", type: "quantitative", title: "Exports ($ billions)", format: ",.2f" },
        ],
      },
    }),
    [p],
  );
  const gSpec = useMemo(
    () => ({
      height: 340,
      config: vegaConfig(p),
      layer: [
        {
          mark: { type: "line", color: p.muted, strokeWidth: 1.5, opacity: 0.8 },
          transform: [{ filter: "datum.kind === 'fit'" }],
          encoding: {
            x: { field: "x", type: "quantitative", scale: { type: "log" } },
            y: { field: "y", type: "quantitative", scale: { type: "log" } },
          },
        },
        {
          transform: [{ filter: "datum.kind === 'pt' && datum.rank <= 8" }],
          mark: { type: "text", align: "left", dx: 7, dy: -7, fontSize: 11.5, fontWeight: 600, color: p.ink2 },
          encoding: {
            x: { field: "x", type: "quantitative", scale: { type: "log" } },
            y: { field: "y", type: "quantitative", scale: { type: "log" } },
            text: { field: "partner" },
          },
        },
        {
          // Circles + their hover label share one layer so the hover selection is in scope.
          transform: [
            { filter: "datum.kind === 'pt'" },
            { calculate: "datum.partner + ' · $' + (datum.y >= 10000 ? format(datum.y / 1000, ',.0f') : datum.y >= 100 ? format(datum.y / 1000, ',.1f') : format(datum.y / 1000, ',.2f')) + 'B exports'", as: "hoverTxt" },
          ],
          encoding: {
            x: { field: "x", type: "quantitative", scale: { type: "log", nice: false }, title: "Distance to partner (km, log scale)", axis: { tickCount: 6, format: "~s" } },
            y: {
              field: "y", type: "quantitative", scale: { type: "log" }, title: "Exports to partner (log scale)",
              axis: { labelExpr: "datum.value >= 1e6 ? '$' + format(datum.value/1e6, '~g') + 'T' : datum.value >= 1000 ? '$' + format(datum.value/1000, '~g') + 'B' : datum.value >= 1 ? '$' + format(datum.value, '~g') + 'M' : '$' + format(datum.value*1000, '~g') + 'K'" },
            },
          },
          layer: [
            {
              params: [{ name: "gh", select: { type: "point", fields: ["partner"], nearest: true, on: "pointermove", clear: "pointerout" } }],
              mark: { type: "circle", cursor: "pointer" },
              encoding: {
                size: { field: "gdp", type: "quantitative", scale: { type: "sqrt", range: [16, 900] }, legend: null },
                color: { value: p.A },
                opacity: { condition: { param: "gh", empty: true, value: 0.78 }, value: 0.35 },
                stroke: { condition: { param: "gh", empty: false, value: p.ink }, value: p.surface },
                strokeWidth: { condition: { param: "gh", empty: false, value: 2 }, value: 1.5 },
              },
            },
            // Hover label: partner name and exports in billions (a halo pass, then the text).
            ...[{ stroke: p.surface, strokeWidth: 5, strokeJoin: "round" }, {}].map((halo) => ({
              mark: {
                type: "text", dy: -12, fontSize: 13, fontWeight: 700, color: p.ink, clip: true, ...halo,
                // Label to the right of the circle, or to the left near the right edge.
                align: { expr: "datum.x > 9000 ? 'right' : 'left'" },
                dx: { expr: "datum.x > 9000 ? -12 : 12" },
              },
              encoding: {
                text: { field: "hoverTxt" },
                opacity: { condition: { param: "gh", empty: false, value: 1 }, value: 0 },
              },
            })),
          ],
        },
      ],
    }),
    [p],
  );

  const setCountry = (n) => C.set(filters.oneOf(n));
  const groups = f ? [f.ldc && "Least developed country", f.lldc && "Landlocked developing", f.sids && "Small island developing state"].filter(Boolean) : [];

  return (
    <>
      <Hero
        eyebrow="International trade · country profile"
        title={name}
        sub="Where does a country sell, and who does it buy from? Follow its exports and imports over time, see which regions and partners matter most, and test the gravity model against its trading partners."
      >
        <div className="tx-controls">
          <GivenSelect given="COUNTRY" label="Country" dot={p.A} />
          <SectorIndustry prefix="C" />
          <YearRange prefix="C" />
        </div>
        <div className="tx-try">
          Try:
          {TRY_COUNTRIES.map((c) => (
            <button key={c} onClick={() => setCountry(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="tx-chips">
          {f && <span className="tx-chip">{[f.sub_region, f.region].filter(Boolean).join(", ") || "No UN region"}</span>}
          {f?.wb_income_group_current && <span className="tx-chip">World Bank: {f.wb_income_group_current}</span>}
          {groups.map((g) => (
            <span className="tx-chip" key={g}>
              {g}
            </span>
          ))}
          <span className="tx-chip">Showing: {selection}</span>
        </div>
      </Hero>

      <main className="tx-body">
        <div className="tx-kpis">
          <Kpi accent={p.A} dot={p.A} label="Exports" value={L ? fmtUSD(L.exports_m) : "–"} sub={L ? <>in {L.year} · {grow != null && <Delta value={grow} suffix="/yr" />} since {F.year}</> : totals.loading ? "loading…" : "no data"} />
          <Kpi accent={p.B} dot={p.B} label="Imports" value={L ? fmtUSD(L.imports_m) : "–"} sub={L ? `in ${L.year}` : ""} />
          <Kpi
            label="Trade balance"
            value={balance == null ? "–" : `${balance >= 0 ? "+" : ""}${fmtUSD(balance)}`}
            sub={balance == null ? "" : balance >= 0 ? "surplus (exports > imports)" : "deficit (imports > exports)"}
          />
          <Kpi label="Export destinations" value={L ? fmtNum(L.export_partners) : "–"} sub={L ? `countries buying in ${L.year}` : ""} />
          <Kpi
            label="Share of output exported"
            value={openness == null ? "–" : fmtPct(openness)}
            sub={D ? `exports ÷ (exports + home sales), ${D.year} · overstated where home-sales data is incomplete` : "production data ends in 2021"}
          />
        </div>

        <div className="tx-grid">
          <Card w={7} title="Exports and imports over time" sub={`Current US dollars · ${selection}. Hover to read values.`}>
            <Legend items={[{ label: "Exports", color: p.A }, { label: "Imports", color: p.B }]} />
            {totals.loading && !lineRows.length ? <Skel h={300} /> : lineRows.length ? <VegaChart spec={lspec} data={lineRows} /> : <Empty />}
            <Explain title="Reading the gap:">
              when the blue line is above the orange one the country runs a trade surplus; below it, a deficit. Watch for the
              2009 financial crisis and the 2020 pandemic — trade falls faster than GDP in downturns.
            </Explain>
          </Card>
          <Card w={5} title="Where do exports go?" sub="Share of exports by destination region, each year. Hover a segment for values.">
            <Legend items={REGIONS.map((r) => ({ label: r, color: p.regions[r], square: true }))} />
            {regions.loading && !regionRows.length ? <Skel h={250} /> : regionRows.length ? <VegaChart spec={regSpec} data={regionRows} /> : <Empty />}
          </Card>

          <Card w={6} title={`Top export destinations${py ? ` (${py})` : ""}`} sub={`Share of ${name}'s exports, with the change since ${pFirst ?? "the first year"}. Click a country to see what the two trade.`}>
            {partners.loading && !partnersLatest.length ? (
              <Skel h={380} />
            ) : partnersLatest.length ? (
              <BarList rows={topList("exports_m")} onPick={(r) => onCompare(name, r.key)} pickHint={(r) => `Compare ${name} and ${r.label} in Two countries`} />
            ) : (
              <Empty />
            )}
          </Card>
          <Card w={6} title={`Top import sources${py ? ` (${py})` : ""}`} sub={`Share of ${name}'s imports, with the change since ${pFirst ?? "the first year"}. Click a country to see what the two trade.`}>
            {partners.loading && !partnersLatest.length ? (
              <Skel h={380} />
            ) : partnersLatest.length ? (
              <BarList rows={topList("imports_m")} onPick={(r) => onCompare(name, r.key)} pickHint={(r) => `Compare ${name} and ${r.label} in Two countries`} />
            ) : (
              <Empty />
            )}
          </Card>

          <Card
            w={12}
            title={`Trade with partners over time`}
            sub={`How ${name}'s trade with its main partners has evolved · ${selection}. Pick a group of partners, a region, or a measure.`}
          >
            <PartnerTrends rows={partners.rows} totals={T} name={name} p={p} onCompare={onCompare} loading={partners.loading} />
          </Card>

          <Card
            w={12}
            title={`The gravity model, live${gYear ? ` (${gYear})` : ""}`}
            sub={`Each circle is a country that buys from ${name}; circle size = the partner's GDP. Point at a circle for its name and value. The grey line is the best power-law fit of exports on distance.`}
          >
            {fit && (
              <div className="tx-stat">
                <div>
                  Distance elasticity
                  <b>{fit.bDist.toFixed(2)}</b>
                </div>
                <div>
                  Partner-size (GDP) elasticity
                  <b>{fit.bGdp.toFixed(2)}</b>
                </div>
                <div>
                  R² (fit)
                  <b>{fit.r2 != null ? fit.r2.toFixed(2) : "–"}</b>
                </div>
                <div>
                  Partners in fit
                  <b>{fit.n}</b>
                </div>
              </div>
            )}
            {partners.loading && !gRows.length ? <Skel h={340} /> : gRows.length ? <VegaChart spec={gSpec} data={gData} /> : <Empty>Gravity variables cover 1986–2019 — widen the year range to include those years.</Empty>}
            <Explain title="How to read the elasticities:">
              they come from a regression of log exports on log partner GDP and log distance across all of {name}'s partners in one
              year. A distance elasticity of −1 means a partner twice as far away buys about half as much, holding size fixed; a GDP
              elasticity near +1 means exports grow in proportion to the partner's economy — the core predictions of the gravity model.
            </Explain>
          </Card>

          <Card w={6} title={`What does ${name} export?${indLatestYear ? ` (${indLatestYear})` : ""}`} sub="Top industries by export value. Click one to filter the page to it.">
            {inds.loading && !indRows.length ? <Skel h={330} /> : indRows.length ? <BarList rows={indList("exports_m", p.A)} onPick={(r) => IND.set(filters.oneOf(r.key))} pickHint={(r) => `Filter to ${r.label}`} /> : <Empty />}
          </Card>
          <Card w={6} title={`What does ${name} import?${indLatestYear ? ` (${indLatestYear})` : ""}`} sub="Top industries by import value. Click one to filter the page to it.">
            {inds.loading && !indRows.length ? <Skel h={330} /> : indRows.length ? <BarList rows={indList("imports_m", p.B)} onPick={(r) => IND.set(filters.oneOf(r.key))} pickHint={(r) => `Filter to ${r.label}`} /> : <Empty />}
          </Card>
        </div>
      </main>
    </>
  );
}
