// ── International Trade Explorer: one page, three tabs ───────────────────────
// All three views live in ONE dashboard so the browser downloads the data once
// per visit. A tab is mounted the first time it is opened and then kept mounted
// (hidden when inactive), so its filters, results and scroll position survive
// switching away and back; after the first view loads, the other tabs warm up
// in the background. Each tab reads only its own givens (B_/C_/W_ plus
// its country pickers), so a change on one tab never re-runs another tab.

const TABS = [
  { id: "bilateral", label: "Two countries", hint: "Bilateral trade between A and B", Comp: BilateralTab },
  { id: "country", label: "One country", hint: "Where a country's trade goes", Comp: CountryTab },
  { id: "world", label: "The world", hint: "Global trade at a glance", Comp: WorldTab },
];

const TAB_CSS = `
.tx-tabs{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:6px;padding:8px 32px;
  background:color-mix(in srgb,var(--hero1) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.08)}
.tx-tabs .brand{color:#fff;font-weight:700;margin-right:14px;letter-spacing:-.01em;white-space:nowrap}
.tx-tabs button{font:inherit;font-size:13.5px;color:#c9d6e6;background:transparent;border:1px solid transparent;border-radius:999px;
  padding:6px 14px;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;line-height:1.2}
.tx-tabs button small{font-size:11px;color:#8ea6c4}
.tx-tabs button:hover{background:rgba(255,255,255,.08);color:#fff}
.tx-tabs button.on{background:#fff;color:#0b1d33;font-weight:650}
.tx-tabs button.on small{color:#52514e}
.tx-tabs .status{margin-left:auto;font-size:12px;color:#9cc3f0;display:flex;align-items:center;gap:8px;white-space:nowrap}
.tx-tabs .spin{width:12px;height:12px;border-radius:50%;border:2px solid rgba(156,195,240,.35);border-top-color:#9cc3f0;animation:txspin .8s linear infinite}
@keyframes txspin{to{transform:rotate(360deg)}}
@media (max-width:760px){.tx-tabs{padding:8px 12px;overflow-x:auto}.tx-tabs button small{display:none}.tx-tabs .brand{display:none}}
`;

export default function Dashboard({ givens }) {
  const [tab, setTab] = useUrlState("tab", "bilateral");
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set([...v, tab])));
  }, [tab]);

  // The first query of the session waits for the data download; show that once.
  const probe = useQuery({ query: "b_pair_countries", givens: pickGivens(givens, ["COUNTRY_A", "COUNTRY_B"]) });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!probe.loading && (probe.rows.length || probe.error)) setReady(true);
  }, [probe.loading, probe.rows.length, probe.error]);

  // Warm-up: once the first view has its data, mount the other tabs (hidden) so
  // their queries run in the background and they are ready when clicked.
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(() => setVisited(new Set(TABS.map((x) => x.id))), 1500);
    return () => clearTimeout(t);
  }, [ready]);

  const go = (id) => {
    setTab(id);
    window.scrollTo({ top: 0 });
    // Charts in a tab that was hidden size themselves on resize; nudge them.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
  };

  return (
    <Shell>
      <style>{TAB_CSS}</style>
      <nav className="tx-tabs" aria-label="Views">
        <span className="brand">International Trade Explorer</span>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => go(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            {t.label}
            <small>{t.hint}</small>
          </button>
        ))}
        {!ready && (
          <span className="status">
            <span className="spin" />
            Loading trade data (first visit only)…
          </span>
        )}
      </nav>
      {TABS.map(({ id, Comp }) =>
        visited.has(id) ? (
          <div key={id} style={{ display: tab === id ? "block" : "none" }}>
            <Comp givens={givens} />
          </div>
        ) : null,
      )}
      <div className="tx-body" style={{ paddingTop: 0 }}>
        <Footer />
      </div>
    </Shell>
  );
}
