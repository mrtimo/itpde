// ── World Trade at a Glance ──────────────────────────────────────────────────
const STORIES = [
  { label: "Full history (1988–2023, goods only before 2000)", range: [1988, 2023] },
  { label: "China joins the WTO (1995–2010)", range: [1995, 2010] },
  { label: "The Great Trade Collapse (2005–2012)", range: [2005, 2012] },
  { label: "Pandemic & recovery (2017–2023)", range: [2017, 2023] },
];
const INCOME = ["Low income", "Lower middle income", "Upper middle income", "High income"];
const INCOME_RAMP = { light: ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"], dark: ["#184f95", "#2a78d6", "#6da7ec", "#b7d3f6"] };
const EVENTS = [
  { year: 2009, text: "Global financial crisis" },
  { year: 2020, text: "COVID-19" },
];

const W_KEYS = ['W_SECTOR', 'W_INDUSTRY', 'W_YEAR_RANGE'];

function WorldTab({ givens: allGivens }) {
  const givens = useMemo(() => pickGivens(allGivens, W_KEYS), [JSON.stringify(pickGivens(allGivens, W_KEYS))]);
  const p = usePalette();
  const dark = useDark();
  const YR = useGiven("W_YEAR_RANGE");
  const industry = cleanIndustry(pickedValue(givens.W_INDUSTRY));
  const sector = pickedValue(givens.W_SECTOR);
  const selection = industry || sector || "all goods & services";

  const sectors = useRows("w_sectors_by_year", givens);
  const structure = useRows("w_structure_by_year", givens);
  const flows = useRows("w_region_flows_by_year", givens);
  const expQ = useRows("w_exporters_by_year", givens);
  const income = useRows("w_income_by_year", givens);
  const exporters = useMemo(() => unnest(expQ.rows, "exporters"), [expQ.rows]);

  const S = structure.rows;
  const L = S.length ? S[S.length - 1] : null;
  const F = S.length ? S[0] : null;
  const grow = L && F && L.year > F.year ? cagr(F.usd_m, L.usd_m, L.year - F.year) : null;
  const P = [...S].reverse().find((r) => r.year <= 2019 && r.pta_trade_share != null) || null;

  const sectorRows = useMemo(() => sectors.rows.map((r) => ({ year: r.year, sector: r.broad_sector, so: SECTORS.indexOf(r.broad_sector), v: r.usd_m / 1000 })), [sectors.rows]);
  const yearsShown = new Set(sectorRows.map((r) => r.year));
  const events = EVENTS.filter((e) => yearsShown.has(e.year));

  const ey = latestYear(exporters);
  const ef = firstYear(exporters);
  const leaders = useMemo(() => {
    const rankAt = (y) => {
      const m = new Map();
      exporters
        .filter((r) => r.year === y)
        .sort((a, b) => b.usd_m - a.usd_m)
        .forEach((r, i) => m.set(r.country, i + 1));
      return m;
    };
    const then = rankAt(ef);
    const now = exporters.filter((r) => r.year === ey).sort((a, b) => b.usd_m - a.usd_m);
    const tot = now.reduce((s, r) => s + r.usd_m, 0);
    return now.slice(0, 12).map((r, i) => {
      const was = then.get(r.country);
      return {
        key: r.country,
        label: `${i + 1}. ${r.country}`,
        value: r.usd_m,
        display: fmtUSD(r.usd_m),
        meta: `${fmtPct(r.usd_m / tot, 1)}${ef !== ey ? (was ? ` · #${was} in ${ef}` : ` · new since ${ef}`) : ""}`,
        tag: r.region,
        color: p.regions[r.region] || p.regions.Other,
      };
    });
  }, [exporters, ey, ef, p]);

  const fy = latestYear(flows.rows);
  const matrix = useMemo(() => {
    const rows = flows.rows.filter((r) => r.year === fy && r.from_region !== "Other" && r.to_region !== "Other");
    const regs = REGIONS.filter((r) => r !== "Other");
    const get = (a, b) => rows.find((r) => r.from_region === a && r.to_region === b)?.usd_m || 0;
    const max = Math.max(...rows.map((r) => r.usd_m), 1);
    return { regs, get, max };
  }, [flows.rows, fy]);
  const heat = (v) => {
    const ramp = PAL.light.seq; // sequential blue, light → dark (cells carry their own text color)
    const t = Math.sqrt(v / matrix.max);
    const i = Math.min(ramp.length - 1, Math.floor(t * ramp.length));
    return { background: v > 0 ? ramp[i] : "transparent", color: i >= 3 ? "#fff" : "#0b0b0b" };
  };

  const shareRows = useMemo(
    () =>
      S.flatMap((r) => [
        { year: r.year, key: "R", v: r.intra_regional_share },
        ...(r.year <= 2019 && r.pta_trade_share != null ? [{ year: r.year, key: "P", v: r.pta_trade_share }] : []),
      ]).filter((r) => r.v != null),
    [S],
  );
  const distRows = useMemo(
    () => S.filter((r) => r.year <= 2019 && r.trade_weighted_distance_km).map((r) => ({ year: r.year, key: "D", v: r.trade_weighted_distance_km })),
    [S],
  );
  const incRows = useMemo(() => income.rows.map((r) => ({ year: r.year, group: r.income_group, v: r.usd_m / 1000 })), [income.rows]);

  const areaSpec = useMemo(
    () => ({
      height: 420,
      config: vegaConfig(p),
      encoding: { x: { field: "year", type: "quantitative", title: null, axis: { format: "d", tickMinStep: 1 }, scale: { nice: false } } },
      layer: [
        {
          mark: { type: "area", interpolate: "monotone", stroke: p.surface, strokeWidth: 1.5, opacity: 0.95 },
          encoding: {
            y: { field: "v", type: "quantitative", stack: "zero", title: null, axis: { labelExpr: BN_LABEL } },
            color: { field: "sector", type: "nominal", scale: { domain: SECTORS, range: SECTORS.map((s) => p.sectors[s]) }, legend: null },
            order: { field: "so", type: "quantitative", sort: "ascending" },
          },
        },
        ...events.map((e) => ({
          data: { values: [e] },
          layer: [
            { mark: { type: "rule", color: p.muted, strokeWidth: 1 }, encoding: { x: { datum: e.year } } },
            { mark: { type: "text", align: "left", dx: 5, y: 8, fontSize: 11.5, color: p.ink2, fontStyle: "italic" }, encoding: { x: { datum: e.year }, text: { value: e.text } } },
          ],
        })),
        {
          params: [{ name: "hw", select: { type: "point", fields: ["year"], nearest: true, on: "pointermove", clear: "pointerout" } }],
          mark: { type: "rule", color: p.ink2, strokeWidth: 1 },
          encoding: { opacity: { condition: { param: "hw", empty: false, value: 1 }, value: 0 } },
        },
        {
          transform: [
            { filter: { param: "hw", empty: false } },
            { aggregate: [{ op: "sum", field: "v", as: "total" }], groupby: ["year"] },
            { calculate: `datum.year + ' · ' + ${bnText("total")}`, as: "txt" },
          ],
          mark: { type: "text", align: "left", dx: 8, y: 22, fontWeight: 700, fontSize: 12.5, color: p.ink },
          encoding: { text: { field: "txt" } },
        },
      ],
    }),
    [p, events.map((e) => e.year).join()],
  );
  const shareSpec = useMemo(
    () => lineSpec({ p, keys: ["R", "P"], colors: [p.A, p.B], yTitle: null, height: 230, yFormat: "format(datum.value, '.0%')", valueText: "format(datum.v, '.1%')", yZero: false }),
    [p],
  );
  const distSpec = useMemo(
    () => lineSpec({ p, keys: ["D"], colors: [p.A], yTitle: null, height: 230, yFormat: "format(datum.value, ',') + ' km'", valueText: "format(datum.v, ',.0f') + ' km'", yZero: true }),
    [p],
  );
  const incSpec = useMemo(
    () => ({
      height: 230,
      config: vegaConfig(p),
      mark: { type: "bar", width: { band: 0.8 }, stroke: p.surface, strokeWidth: 1 },
      encoding: {
        x: { field: "year", type: "ordinal", title: null, axis: { labelAngle: 0, labelExpr: "datum.value % 5 == 0 ? datum.value : ''" } },
        y: { field: "v", type: "quantitative", stack: "normalize", title: null, axis: { format: ".0%" } },
        color: { field: "group", type: "ordinal", scale: { domain: INCOME, range: dark ? INCOME_RAMP.dark : INCOME_RAMP.light }, legend: null },
        order: { field: "rank", type: "quantitative" },
        tooltip: [
          { field: "year", type: "ordinal", title: "Year" },
          { field: "group", title: "Exporter income group" },
          { field: "v", type: "quantitative", title: "Exports ($ billions)", format: ",.1f" },
        ],
      },
    }),
    [p, dark],
  );

  const setRange = (lo, hi) => YR.set(filters.between(lo, hi));

  return (
    <>
      <Hero
        eyebrow="International trade · the big picture"
        title="World Trade at a Glance"
        sub="How much the world trades across borders, in what, between which regions — and how globalisation has ebbed and flowed since the late 1980s."
      >
        <div className="tx-controls">
          <SectorIndustry prefix="W" />
          <YearRange prefix="W" />
        </div>
        <div className="tx-try">
          Explore:
          {STORIES.map((s) => (
            <button key={s.label} onClick={() => setRange(...s.range)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="tx-chips">
          <span className="tx-chip">Showing: {selection}</span>
          <span className="tx-chip">Cross-border trade only (domestic sales excluded)</span>
        </div>
      </Hero>

      <main className="tx-body">
        <div className="tx-kpis">
          <Kpi accent={p.A} label="World cross-border trade" value={L ? fmtUSD(L.usd_m) : "–"} sub={L ? `in ${L.year}` : structure.loading ? "loading…" : "no data"} />
          <Kpi label="Growth" value={grow == null ? "–" : <Delta value={grow} suffix="/yr" />} sub={grow == null ? "" : `compound annual, ${F.year}–${L.year}`} />
          <Kpi label="Trade within the same region" value={L ? fmtPct(L.intra_regional_share) : "–"} sub={L ? `of cross-border trade, ${L.year}` : ""} />
          <Kpi label="Trade under a trade agreement" value={P ? fmtPct(P.pta_trade_share) : "–"} sub={P ? `share in ${P.year} (agreement data ends 2019)` : "agreement data covers 1986–2019"} />
          <Kpi label="Exporting economies" value={L ? fmtNum(L.exporters) : "–"} sub={L ? `with positive exports, ${L.year}` : ""} />
        </div>

        <div className="tx-grid">
          <Card w={8} title="World trade by sector" sub={`Cross-border trade, current US dollars · ${selection}. Hover for the yearly total.`}>
            <Legend items={SECTORS.map((s) => ({ label: s, color: p.sectors[s], square: true }))} />
            {sectors.loading && !sectorRows.length ? <Skel h={420} /> : sectorRows.length ? <VegaChart spec={areaSpec} data={sectorRows} /> : <Empty />}
            <Explain title="Coverage changes:">
              ITPD-E includes services only from 2000 and changes its services sources in 2004 and 2010, so jumps in the purple
              band are partly coverage, not real growth. Pick a single sector above for a like-for-like trend.
            </Explain>
          </Card>
          <Card w={4} title={`Top exporters${ey ? ` (${ey})` : ""}`} sub={`Share of world exports, with rank in ${ef ?? "the first year"}.`}>
            {expQ.loading && !leaders.length ? <Skel h={420} /> : leaders.length ? <BarList rows={leaders} /> : <Empty />}
          </Card>

          <Card w={6} title={`Who sells to whom?${fy ? ` (${fy})` : ""}`} sub="Cross-border trade between UN regions, exporter region (rows) → importer region (columns), $ billions. The diagonal is trade within a region.">
            {flows.loading && !flows.rows.length ? (
              <Skel h={260} />
            ) : (
              <table className="tx-heat">
                <thead>
                  <tr>
                    <th>From ↓ / To →</th>
                    {matrix.regs.map((r) => (
                      <th key={r}>{r}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.regs.map((a) => (
                    <tr key={a}>
                      <th>
                        <span className="tx-dot" style={{ background: p.regions[a], marginRight: 6, width: 8, height: 8 }} />
                        {a}
                      </th>
                      {matrix.regs.map((b) => {
                        const v = matrix.get(a, b);
                        return (
                          <td key={b} style={{ ...heat(v), outline: a === b ? `2px solid ${p.ink2}` : "none", outlineOffset: -2 }} title={`${a} → ${b}: ${fmtUSD(v)}`}>
                            {v >= 1000 ? `${Math.round(v / 1000).toLocaleString()}` : v > 0 ? (v / 1000).toFixed(1) : "–"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Explain title="Regional blocs:">
              Europe and Asia trade mostly with themselves — the outlined diagonal cells — thanks to short distances, deep supply
              chains and agreements like the EU single market.
            </Explain>
          </Card>
          <Card w={6} title="Is trade becoming more regional?" sub="Share of cross-border trade within the same UN region, and between partners with a trade agreement (to 2019).">
            <Legend items={[{ label: "Within the same region", color: p.A }, { label: "Covered by a trade agreement", color: p.B }]} />
            {structure.loading && !shareRows.length ? <Skel h={230} /> : shareRows.length ? <VegaChart spec={shareSpec} data={shareRows} /> : <Empty />}
            <Explain title="The rise of trade agreements:">
              the number of preferential trade agreements exploded after the 1990s, and a growing share of world trade now moves
              between partners that have one.
            </Explain>
          </Card>

          <Card w={6} title="Who exports? Rich and poor economies" sub="Share of world exports by the exporter's World Bank income group in that year.">
            <Legend items={INCOME.map((g, i) => ({ label: g, color: (dark ? INCOME_RAMP.dark : INCOME_RAMP.light)[i], square: true }))} />
            {income.loading && !incRows.length ? <Skel h={230} /> : incRows.length ? <VegaChart spec={incSpec} data={incRows.map((r) => ({ ...r, rank: INCOME.indexOf(r.group) }))} /> : <Empty />}
            <Explain title="Countries move between groups:">
              the income group is the one the country had in each year — so China's shift from lower-middle to upper-middle income
              (2010) moves its exports between bands.
            </Explain>
          </Card>
          <Card w={6} title="Is distance dead?" sub="Average distance travelled by a dollar of cross-border trade (trade-weighted, km; gravity data to 2019).">
            {structure.loading && !distRows.length ? <Skel h={230} /> : distRows.length ? <VegaChart spec={distSpec} data={distRows} /> : <Empty />}
            <Explain title="Distance still matters:">
              despite cheaper shipping and the internet, the average dollar of trade still travels only about 5,000 km — far
              less than the distance between random pairs of countries. Most trade is with neighbours, just as the gravity model
              predicts.
            </Explain>
          </Card>
        </div>
      </main>
    </>
  );
}
