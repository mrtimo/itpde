// ── Bilateral Trade Explorer ─────────────────────────────────────────────────
const TRY_PAIRS = [
  ["United States", "China"],
  ["Germany", "France"],
  ["United States", "Mexico"],
  ["Japan", "Korea, South"],
  ["Brazil", "Argentina"],
  ["Australia", "China"],
  ["Russia", "Ukraine"],
];

function byYearDir(rows, field = "usd_m") {
  const m = new Map();
  for (const r of rows) {
    const o = m.get(r.year) || { year: r.year, AB: 0, BA: 0 };
    o[r.direction] += r[field] || 0;
    m.set(r.year, o);
  }
  return [...m.values()].sort((a, b) => a.year - b.year);
}

function PairFacts({ rows, aName, bName, p }) {
  if (!rows.length) return <Empty>The gravity dataset covers 1986–2019; no pair data for this selection.</Empty>;
  const last = rows[rows.length - 1];
  // First year of the current unbroken run of an indicator (e.g. "agreement since 1994").
  const since = (f) => {
    if (!last[f]) return null;
    let y = last.year;
    for (let i = rows.length - 1; i >= 0 && rows[i][f]; i--) y = rows[i].year;
    return y;
  };
  const yn = (v, extra) => (
    <span className={v ? "tx-yes" : "tx-no"}>
      {v ? "Yes" : "No"}
      {v && extra ? <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}> · {extra}</span> : null}
    </span>
  );
  const pta = since("agree_pta");
  const gdpRow = [...rows].reverse().find((r) => r.a_gdp_bn || r.b_gdp_bn) || last;
  const bothWto = last.a_wto && last.b_wto;
  let wtoSince = null;
  if (bothWto) {
    wtoSince = last.year;
    for (let i = rows.length - 1; i >= 0 && rows[i].a_wto && rows[i].b_wto; i--) wtoSince = rows[i].year;
  }
  const kind = last.agree_cu ? "customs union" : last.agree_fta ? "free trade agreement" : last.agree_pta ? "preferential agreement" : null;
  return (
    <>
      <div className="tx-facts">
        <div className="tx-fact">
          <div className="k">Distance</div>
          <div className="v">{fmtNum(last.distance_km)} km</div>
        </div>
        <div className="tx-fact">
          <div className="k">Shared border</div>
          <div className="v">{yn(last.contiguity)}</div>
        </div>
        <div className="tx-fact">
          <div className="k">Common language</div>
          <div className="v">{yn(last.common_language)}</div>
        </div>
        <div className="tx-fact">
          <div className="k">Colonial tie (ever)</div>
          <div className="v">{yn(last.colony_ever)}</div>
        </div>
        <div className="tx-fact">
          <div className="k">Trade agreement ({last.year})</div>
          <div className="v">{yn(pta, kind && pta ? `${kind}, since ${pta}` : null)}</div>
        </div>
        <div className="tx-fact">
          <div className="k">Both in GATT/WTO</div>
          <div className="v">{yn(bothWto, wtoSince ? `since ${wtoSince <= 1995 && rows[0].year === wtoSince ? "≤" : ""}${wtoSince}` : null)}</div>
        </div>
        <div className="tx-fact">
          <div className="k">
            <span className="tx-dot" style={{ background: p.A, marginRight: 6 }} />
            {aName} GDP ({gdpRow.year})
          </div>
          <div className="v">{gdpRow.a_gdp_bn ? fmtUSD(gdpRow.a_gdp_bn * 1000) : "–"}</div>
        </div>
        <div className="tx-fact">
          <div className="k">
            <span className="tx-dot" style={{ background: p.B, marginRight: 6 }} />
            {bName} GDP ({gdpRow.year})
          </div>
          <div className="v">{gdpRow.b_gdp_bn ? fmtUSD(gdpRow.b_gdp_bn * 1000) : "–"}</div>
        </div>
      </div>
      <Explain title="The gravity model.">
        Like Newton's law of gravity, trade between two countries tends to rise with the size of both economies (GDP) and fall
        with the distance between them: <i>Trade ≈ G × GDP<sub>A</sub> × GDP<sub>B</sub> / Distance</i>. Shared borders,
        languages, colonial history and trade agreements all push trade above what size and distance alone predict.
      </Explain>
    </>
  );
}

const B_KEYS = ['COUNTRY_A', 'COUNTRY_B', 'B_SECTOR', 'B_INDUSTRY', 'B_YEAR_RANGE'];

function BilateralTab({ givens: allGivens }) {
  const givens = useMemo(() => pickGivens(allGivens, B_KEYS), [JSON.stringify(pickGivens(allGivens, B_KEYS))]);
  const p = usePalette();
  const A = useGiven("COUNTRY_A");
  const B = useGiven("COUNTRY_B");
  const IND = useGiven("B_INDUSTRY");
  const aName = pickedValue(A.value) || "Country A";
  const bName = pickedValue(B.value) || "Country B";
  const industry = cleanIndustry(pickedValue(givens.B_INDUSTRY));
  const sector = pickedValue(givens.B_SECTOR);
  const same = aName === bName;

  const flows = useRows("b_flows_by_year", givens);
  const sectors = useRows("b_sector_by_year", givens);
  const indsQ = useRows("b_industries_by_year", givens);
  const inds = useMemo(() => ({ loading: indsQ.loading, rows: unnest(indsQ.rows, "industries") }), [indsQ.rows, indsQ.loading]);
  const share = useRows("b_partner_share_by_year", givens);
  const facts = useRows("b_pair_facts_by_year", givens);
  const who = useRows("b_pair_countries", givens);

  const years = useMemo(() => byYearDir(flows.rows), [flows.rows]);
  const L = years.length ? years[years.length - 1] : null;
  const F = years.find((y) => y.AB + y.BA > 0) || null;
  const growth = L && F && L.year > F.year ? cagr(F.AB + F.BA, L.AB + L.BA, L.year - F.year) : null;
  const balance = L ? L.AB - L.BA : null;
  const selection = industry || sector || "all goods & services";

  const lineRows = useMemo(
    () =>
      years.flatMap((y) => [
        { year: y.year, key: "AB", v: y.AB / 1000 },
        { year: y.year, key: "BA", v: y.BA / 1000 },
      ]),
    [years],
  );
  const balRows = useMemo(() => years.map((y) => ({ year: y.year, v: (y.AB - y.BA) / 1000, side: y.AB >= y.BA ? "A" : "B" })), [years]);

  const shareRows = useMemo(
    () => share.rows.map((r) => ({ year: r.year, key: r.direction, v: r.world_m > 0 ? r.partner_m / r.world_m : null })).filter((r) => r.v != null),
    [share.rows],
  );

  // Industries in the latest year + Grubel–Lloyd intra-industry trade index.
  const indLatest = useMemo(() => {
    const y = latestYear(inds.rows);
    const rows = inds.rows.filter((r) => r.year === y);
    const ab = rows.filter((r) => r.direction === "AB").sort((a, b) => b.usd_m - a.usd_m);
    const ba = rows.filter((r) => r.direction === "BA").sort((a, b) => b.usd_m - a.usd_m);
    const m = new Map();
    for (const r of rows) {
      const o = m.get(r.industry_descr) || { x: 0, mm: 0 };
      if (r.direction === "AB") o.x += r.usd_m;
      else o.mm += r.usd_m;
      m.set(r.industry_descr, o);
    }
    let num = 0,
      den = 0;
    for (const o of m.values()) {
      num += Math.abs(o.x - o.mm);
      den += o.x + o.mm;
    }
    return { year: y, ab, ba, gl: den > 0 ? 1 - num / den : null };
  }, [inds.rows]);

  const sectorRows = (dir) => sectors.rows.filter((r) => r.direction === dir).map((r) => ({ year: r.year, sector: r.broad_sector, so: SECTORS.indexOf(r.broad_sector), v: r.usd_m / 1000 }));

  const lspec = useMemo(
    () => lineSpec({ p, keys: ["AB", "BA"], colors: [p.A, p.B], yTitle: null, yFormat: BN_LABEL, valueText: bnText("v"), height: 340 }),
    [p],
  );
  const sspec = useMemo(
    () =>
      lineSpec({
        p, keys: ["AB", "BA"], colors: [p.A, p.B], yTitle: null, height: 220,
        yFormat: "format(datum.value, '.0%')", valueText: "format(datum.v, '.1%')",
      }),
    [p],
  );
  const bspec = useMemo(
    () => ({
      height: 220,
      config: vegaConfig(p),
      layer: [
        {
          params: [{ name: "hb", select: { type: "point", fields: ["year"], on: "pointerover", clear: "pointerout" } }],
          mark: { type: "bar", cornerRadiusEnd: 3, width: { band: 0.72 } },
          encoding: {
            x: { field: "year", type: "ordinal", title: null, axis: { labelAngle: 0, labelExpr: "datum.value % 5 == 0 ? datum.value : ''" } },
            y: { field: "v", type: "quantitative", title: null, axis: { labelExpr: BN_LABEL } },
            color: { field: "side", type: "nominal", scale: { domain: ["A", "B"], range: [p.A, p.B] }, legend: null },
            opacity: { condition: { param: "hb", empty: true, value: 1 }, value: 0.45 },
          },
        },
        {
          mark: { type: "rule", color: p.axis },
          encoding: { y: { datum: 0 } },
        },
        {
          transform: [{ filter: { param: "hb", empty: false } }, { calculate: `datum.year + ': ' + (datum.v >= 0 ? '+' : '−') + ${bnText("v").replace(/datum\.v/g, "abs(datum.v)")}`, as: "txt" }],
          mark: { type: "text", fontWeight: 650, fontSize: 12, y: -8, color: p.ink },
          encoding: { x: { field: "year", type: "ordinal" }, text: { field: "txt" } },
        },
      ],
    }),
    [p],
  );
  const mixSpec = useMemo(
    () => ({
      height: 190,
      config: vegaConfig(p),
      mark: { type: "bar", width: { band: 0.8 }, stroke: p.surface, strokeWidth: 1 },
      encoding: {
        x: { field: "year", type: "ordinal", title: null, axis: { labelAngle: 0, labelExpr: "datum.value % 5 == 0 ? datum.value : ''" } },
        y: { field: "v", type: "quantitative", stack: "normalize", title: null, axis: { format: ".0%" } },
        color: { field: "sector", type: "nominal", scale: { domain: SECTORS, range: SECTORS.map((s) => p.sectors[s]) }, legend: null },
        order: { field: "so", type: "quantitative", sort: "ascending" },
        tooltip: [
          { field: "year", type: "ordinal", title: "Year" },
          { field: "sector", type: "nominal", title: "Sector" },
          { field: "v", type: "quantitative", title: "Exports ($ billions)", format: ",.2f" },
        ],
      },
    }),
    [p],
  );

  const setPair = (a, b) => {
    A.set(filters.oneOf(a));
    B.set(filters.oneOf(b));
  };
  const swap = () => setPair(bName, aName);
  const chips = who.rows.slice().sort((x, y) => (x.side < y.side ? -1 : 1));

  return (
    <>
      <Hero
        eyebrow="International trade · ITPD-E 1986–2023"
        title={same ? "Bilateral Trade Explorer" : `${aName} ⇄ ${bName}`}
        sub="Pick two economies to see how much they sell to each other, who runs the surplus, what they trade, and how the relationship has changed over time. Narrow it to one sector or industry to see its story."
      >
        <div className="tx-controls">
          <GivenSelect given="COUNTRY_A" label="Country A" dot={p.A} />
          <button className="tx-swap" onClick={swap} title="Swap countries" aria-label="Swap countries">⇄</button>
          <GivenSelect given="COUNTRY_B" label="Country B" dot={p.B} />
          <SectorIndustry prefix="B" />
          <YearRange prefix="B" />
        </div>
        <div className="tx-try">
          Try:
          {TRY_PAIRS.map(([a, b]) => (
            <button key={a + b} onClick={() => setPair(a, b)}>
              {a} ⇄ {b}
            </button>
          ))}
        </div>
        {chips.length > 0 && (
          <div className="tx-chips">
            {chips.map((c) => (
              <span className="tx-chip" key={c.country_name}>
                <span className="tx-dot" style={{ background: c.side === "A" ? p.A : p.B, marginRight: 6, width: 8, height: 8 }} />
                {c.country_name}: {c.sub_region || c.region || "—"}
                {c.wb_income_group_current ? ` · ${c.wb_income_group_current}` : ""}
              </span>
            ))}
            <span className="tx-chip">Showing: {selection}</span>
          </div>
        )}
      </Hero>

      <main className="tx-body">
        {same ? (
          <Card w={12} title="Pick two different countries">
            <Empty>Country A and Country B are the same. Choose a different partner to see bilateral trade.</Empty>
          </Card>
        ) : (
          <>
            <div className="tx-kpis">
              <Kpi
                accent={p.A}
                dot={p.A}
                label={`${aName} → ${bName}`}
                value={L ? fmtUSD(L.AB) : "–"}
                sub={L ? `exports in ${L.year}` : flows.loading ? "loading…" : "no data"}
              />
              <Kpi
                accent={p.B}
                dot={p.B}
                label={`${bName} → ${aName}`}
                value={L ? fmtUSD(L.BA) : "–"}
                sub={L ? `exports in ${L.year}` : ""}
              />
              <Kpi label="Two-way trade" value={L ? fmtUSD(L.AB + L.BA) : "–"} sub={L ? `total in ${L.year}` : ""} />
              <Kpi
                accent={balance == null ? undefined : balance >= 0 ? p.A : p.B}
                label={`${aName}'s trade balance`}
                value={balance == null ? "–" : `${balance >= 0 ? "+" : ""}${fmtUSD(balance)}`}
                sub={balance == null ? "" : balance >= 0 ? `surplus with ${bName}` : `deficit with ${bName}`}
              />
              <Kpi
                label="Growth of two-way trade"
                value={growth == null ? "–" : <Delta value={growth} suffix="/yr" />}
                sub={growth == null ? "" : `compound annual, ${F.year}–${L.year}`}
              />
            </div>

            <div className="tx-grid">
              <Card w={8} title="Exports in each direction" sub={`Annual exports, current US dollars · ${selection}. Hover to read values.`}>
                <Legend items={[{ label: `${aName} → ${bName}`, color: p.A }, { label: `${bName} → ${aName}`, color: p.B }]} />
                {flows.loading && !lineRows.length ? <Skel h={260} /> : lineRows.length ? <VegaChart spec={lspec} data={lineRows} /> : <Empty />}
                <Explain title="Exports = imports, seen from the other side.">
                  {aName}'s exports to {bName} are {bName}'s imports from {aName}. Where one side's report is missing, ITPD-E fills it
                  in from the partner's report (a "mirror" value).
                </Explain>
              </Card>
              <Card w={4} title="Gravity check" sub="What the gravity model says about this pair (USITC Dynamic Gravity Dataset, latest year ≤ 2019).">
                {facts.loading && !facts.rows.length ? <Skel h={300} /> : <PairFacts rows={facts.rows} aName={aName} bName={bName} p={p} />}
              </Card>

              <Card w={6} title={`${aName}'s bilateral trade balance`} sub={`Exports to ${bName} minus imports from ${bName}. Above zero = surplus, below = deficit.`}>
                <Legend items={[{ label: `${aName} surplus`, color: p.A, square: true }, { label: `${bName} surplus`, color: p.B, square: true }]} />
                {flows.loading && !balRows.length ? <Skel h={220} /> : balRows.length ? <VegaChart spec={bspec} data={balRows} /> : <Empty />}
                <Explain title="Is a deficit bad?">
                  Not necessarily. A bilateral deficit means one partner buys more from the other than it sells; what matters for the
                  economy as a whole is the overall balance with all partners, which reflects national saving and investment.
                </Explain>
              </Card>
              <Card w={6} title="How much does each partner matter?" sub="Share of each country's total exports (to all partners, same sector/industry) that goes to the other.">
                <Legend
                  items={[
                    { label: `Share of ${aName}'s exports going to ${bName}`, color: p.A },
                    { label: `Share of ${bName}'s exports going to ${aName}`, color: p.B },
                  ]}
                />
                {share.loading && !shareRows.length ? <Skel h={220} /> : shareRows.length ? <VegaChart spec={sspec} data={shareRows} /> : <Empty />}
                <Explain title="Asymmetric dependence.">
                  A big economy is often a large market for a small partner while the reverse is not true — so a trade dispute can hurt
                  the two sides very differently.
                </Explain>
              </Card>

              <Card
                w={12}
                title={`What do they trade?${indLatest.year ? ` (${indLatest.year})` : ""}`}
                sub="Top industries in each direction. Click an industry to filter the whole page to it."
              >
                {indLatest.gl != null && (
                  <div className="tx-stat">
                    <div>
                      Intra-industry trade (Grubel–Lloyd index)
                      <b>{indLatest.gl.toFixed(2)}</b>
                    </div>
                    <div>
                      Industries traded
                      <b>{new Set([...indLatest.ab, ...indLatest.ba].map((r) => r.industry_descr)).size}</b>
                    </div>
                  </div>
                )}
                {inds.loading && !indLatest.ab.length ? (
                  <Skel h={300} />
                ) : (
                  <div className="tx-two">
                    {[
                      ["AB", indLatest.ab, p.A, `${aName} → ${bName}`],
                      ["BA", indLatest.ba, p.B, `${bName} → ${aName}`],
                    ].map(([k, rows, color, title]) => {
                      const tot = rows.reduce((s, r) => s + r.usd_m, 0);
                      return (
                        <div key={k}>
                          <div className="tx-colhead">
                            <span className="tx-dot" style={{ background: color }} />
                            {title}
                          </div>
                          {rows.length ? (
                            <BarList
                              color={color}
                              rows={rows.slice(0, 10).map((r) => ({
                                key: r.industry_descr,
                                label: cleanIndustry(r.industry_descr),
                                value: r.usd_m,
                                display: fmtUSD(r.usd_m),
                                meta: tot > 0 ? fmtPct(r.usd_m / tot, 0) : null,
                              }))}
                              onPick={(r) => IND.set(filters.oneOf(r.key))}
                              pickHint={(r) => `Filter the page to ${r.label}`}
                            />
                          ) : (
                            <Empty />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <Explain title="Grubel–Lloyd index:">
                  0 means the two countries trade completely different products (inter-industry trade, as in comparative-advantage
                  models); 1 means they exchange the same kinds of products in both directions (intra-industry trade, typical between
                  similar rich economies — think cars for cars).
                </Explain>
              </Card>

              <Card w={12} title="How the mix has changed" sub="Each direction's exports split by broad sector (share of the year's total).">
                <Legend items={SECTORS.map((s) => ({ label: s, color: p.sectors[s], square: true }))} />
                <div className="tx-two">
                  {[
                    ["AB", `${aName} → ${bName}`, p.A],
                    ["BA", `${bName} → ${aName}`, p.B],
                  ].map(([k, title, color]) => {
                    const rows = sectorRows(k);
                    return (
                      <div key={k}>
                        <div className="tx-colhead">
                          <span className="tx-dot" style={{ background: color }} />
                          {title}
                        </div>
                        {sectors.loading && !rows.length ? <Skel h={190} /> : rows.length ? <VegaChart spec={mixSpec} data={rows} /> : <Empty />}
                      </div>
                    );
                  })}
                </div>
                <Explain title="Coverage note:">
                  ITPD-E covers agriculture from 1986, manufacturing and mining & energy from 1988, and services from 2000 — so mixes
                  before 2000 show goods only.
                </Explain>
              </Card>
            </div>
          </>
        )}
      </main>
    </>
  );

}

