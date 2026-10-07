/* International Trade Explorer — page startup (inlined by site_assets/seo.py).
 *
 * Runs before the malloyyo runtime (trade.js) and changes two things without
 * touching the runtime itself:
 *
 * 1. Readable links. The runtime keeps filters (givens) as `$NAME=…` and view
 *    state as `~key=…` in the query string, which browsers show as %24NAME and
 *    %7Ekey. The address bar uses short plain names instead
 *    (?a=Germany&b=France&years=2010-2023&tab=country), and leaves out filters
 *    still at their default. Translation happens only at the edge: incoming
 *    links are converted to the runtime's form before it reads them, and every
 *    address it writes is converted back.
 *
 * 2. Data in the browser cache. The runtime downloads each data file from
 *    Hugging Face with fetch(). Those URLs redirect with `no-store` to a CDN
 *    address whose signature changes every time, so the browser's HTTP cache
 *    never helps. Here, data downloads start immediately (in parallel with
 *    DuckDB-WASM starting up, instead of after it) and are kept in Cache
 *    Storage under each file's Hugging Face version id (git blob oid), so other
 *    tabs and later visits read them locally. A file is downloaded again only
 *    when it changes on Hugging Face.
 */
(function () {
  "use strict";

  // ── 1. Readable links ─────────────────────────────────────────────────────
  // Short public names for each given; anything not listed is lower-cased.
  var GIVEN_ALIAS = {
    COUNTRY_A: "a", COUNTRY_B: "b",
    B_SECTOR: "sector", B_INDUSTRY: "industry", B_YEAR_RANGE: "years",
    COUNTRY: "country", C_SECTOR: "country_sector", C_INDUSTRY: "country_industry", C_YEAR_RANGE: "country_years",
    W_SECTOR: "world_sector", W_INDUSTRY: "world_industry", W_YEAR_RANGE: "world_years",
  };
  // Public names for view state (useUrlState keys in the components).
  var VIEW_ALIAS = { cpg: "partners", cpm: "measure", cps: "show" };

  function specs() { return window.__GIVENS__ || []; }
  function specOf(name) { return specs().find(function (s) { return s.name === name; }); }
  function publicGiven(name) { return GIVEN_ALIAS[name] || name.toLowerCase(); }
  function publicView(key) { return VIEW_ALIAS[key] || key; }

  var SPECIAL = /[,;%_|()\\]/;          // characters with meaning in a Malloy string filter
  function unescapeFilter(v) { return v.replace(/\\(.)/g, "$1"); }
  function escapeFilter(v) {
    return SPECIAL.test(v) || /^-/.test(v) ? v.replace(/([\\,;%_|()])/g, "\\$1").replace(/^-/, "\\-") : v;
  }
  // Internal filter value -> readable value.
  function prettyValue(name, v) {
    var s = specOf(name);
    if (s && s.filterType === "number") {
      var m = /^\[(\d{4}) to (\d{4})\]$/.exec(v);
      return m ? m[1] + "-" + m[2] : v;
    }
    if (s && s.filterType === "string") {
      // A single exact value (everything special is escaped) reads as plain text.
      var unescapedSpecial = v.replace(/\\./g, "").search(/[,;%_|()]/) >= 0 || /^-/.test(v);
      return unescapedSpecial ? v : unescapeFilter(v);
    }
    return v;
  }
  // Readable value -> internal filter value.
  function internalValue(name, v) {
    var s = specOf(name);
    if (s && s.filterType === "number") {
      var m = /^(\d{4})-(\d{4})$/.exec(v);
      return m ? "[" + m[1] + " to " + m[2] + "]" : v;
    }
    if (s && s.filterType === "string") return v.indexOf("\\") >= 0 ? v : escapeFilter(v);
    return v;
  }

  function toPublic(search) {
    var out = new URLSearchParams();
    new URLSearchParams(search).forEach(function (v, k) {
      if (k.charAt(0) === "$") {
        var name = k.slice(1), s = specOf(name);
        if (s && String(s.default == null ? "" : s.default) === v) return;   // still at its default
        out.set(publicGiven(name), prettyValue(name, v));
      } else if (k.charAt(0) === "~") {
        out.set(publicView(k.slice(1)), v);
      } else {
        out.set(k, v);
      }
    });
    var q = out.toString();
    return q ? "?" + q : "";
  }

  function fromPublic(search) {
    var byPublic = {};
    specs().forEach(function (s) { byPublic[publicGiven(s.name)] = s.name; });
    var viewByPublic = {};
    Object.keys(VIEW_ALIAS).forEach(function (k) { viewByPublic[VIEW_ALIAS[k]] = k; });
    var out = new URLSearchParams();
    new URLSearchParams(search).forEach(function (v, k) {
      if (k.charAt(0) === "$" || k.charAt(0) === "~") out.set(k, v);                // already internal
      else if (byPublic[k]) out.set("$" + byPublic[k], internalValue(byPublic[k], v)); // a filter
      else out.set("~" + (viewByPublic[k] || k), v);                                 // view state
    });
    var q = out.toString();
    return q ? "?" + q : "";
  }

  // The explorer lives at the site root; the runtime names it ./trade.html.
  function publicPath(path) { return path.replace(/\/trade(\.html)?$/, "/"); }

  var origReplace = history.replaceState.bind(history);
  var origPush = history.pushState.bind(history);
  // Before the runtime reads location.search: readable link -> internal form.
  origReplace(history.state, "", location.pathname + fromPublic(location.search) + location.hash);
  // Every address the runtime writes: internal form -> readable link.
  function wrap(orig) {
    return function (state, title, url) {
      if (url != null) {
        var u = new URL(url, location.href);
        url = publicPath(u.pathname) + toPublic(u.search) + u.hash;
      }
      return orig(state, title, url);
    };
  }
  history.replaceState = wrap(origReplace);
  history.pushState = wrap(origPush);
  // Once the runtime has read the URL, show the readable form straight away.
  document.addEventListener("DOMContentLoaded", function () {
    origReplace(history.state, "", publicPath(location.pathname) + toPublic(location.search) + location.hash);
  });

  // ── 2. Data: start early, keep in Cache Storage ───────────────────────────
  var DATA_CACHE = "itpde-data-v1";   // bump the suffix to discard every cached copy
  var HF_FILE = /^https:\/\/huggingface\.co\/datasets\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/;
  var t0 = performance.now();
  var log = function (msg) { console.info("[data] " + msg + " (" + Math.round(performance.now() - t0) + " ms)"); };

  var cacheP = (function () {
    try { return caches.open(DATA_CACHE).catch(function () { return null; }); }
    catch (e) { return Promise.resolve(null); }   // no Cache Storage (e.g. some private windows)
  })();

  // url -> Hugging Face version id (git blob oid), from one tree listing per repo.
  var versionsP = (function () {
    var urls = Object.values(window.__TABLE_FILES__ || {});
    var repos = {};
    urls.forEach(function (url) {
      var m = HF_FILE.exec(url);
      if (!m) return;
      var key = m[1] + "@" + m[2];
      (repos[key] = repos[key] || { repo: m[1], rev: m[2], files: {} }).files[m[3]] = url;
    });
    var out = new Map();
    return Promise.all(Object.keys(repos).map(function (key) {
      var r = repos[key];
      return fetch("https://huggingface.co/api/datasets/" + r.repo + "/tree/" + r.rev + "?recursive=true", { cache: "no-store" })
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (list) {
          list.forEach(function (f) { if (r.files[f.path] && f.oid) out.set(r.files[f.path], f.oid); });
        })
        .catch(function () {});   // offline or blocked: use whatever is cached
    })).then(function () { return out; });
  })();

  var origFetch = window.fetch.bind(window);
  var stats = { cached: 0, downloaded: 0 };

  function download(url) {
    return origFetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status + " " + r.statusText);
      return r.arrayBuffer();
    });
  }

  function load(url) {
    return Promise.all([cacheP, versionsP]).then(function (res) {
      var cache = res[0], version = res[1].get(url);
      if (!cache) { stats.downloaded++; return download(url); }
      var wanted = version ? url + "?v=" + version : null;
      return cache.keys().then(function (keys) {
        keys = keys.filter(function (k) { return k.url.split("?v=")[0] === url; });
        // the current version, or — if the listing couldn't be read — any copy
        var hit = keys.find(function (k) { return wanted ? k.url === wanted : true; });
        var fromCache = hit ? cache.match(hit).then(function (r) { return r ? r.arrayBuffer() : null; }) : Promise.resolve(null);
        return fromCache.then(function (buf) {
          if (buf) { stats.cached++; return buf; }
          return download(url).then(function (buf) {
            stats.downloaded++;
            if (wanted) {
              cache.put(wanted, new Response(buf))
                .then(function () { return Promise.all(keys.filter(function (k) { return k.url !== wanted; }).map(function (k) { return cache.delete(k); })); })
                .catch(function () {});   // storage full or refused: the page still has the bytes
            }
            return buf;
          });
        });
      });
    }).catch(function (e) {
      console.warn("[data] cache unavailable for " + url + "; downloading", e);
      stats.downloaded++;
      return download(url);
    });
  }

  // Start every data file now, in parallel with DuckDB-WASM starting up.
  var pending = new Map();
  var dataUrls = Object.values(window.__TABLE_FILES__ || {}).filter(function (u) { return HF_FILE.test(u); });
  dataUrls.forEach(function (url) { pending.set(url, load(url)); });
  Promise.all(pending.values()).then(function () {
    log("data ready: " + dataUrls.length + " files, " + stats.cached + " from the browser cache, " + stats.downloaded + " downloaded");
  }, function () {});

  // One timing line when the explorer has its first data on screen.
  new MutationObserver(function (_, obs) {
    if (document.querySelector(".tx-tabs .source")) { obs.disconnect(); log("explorer ready"); }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // The runtime asks for the same URLs with fetch(); answer from the early loads.
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    var method = (init && init.method) || (input && input.method) || "GET";
    if (url && method.toUpperCase() === "GET" && pending.has(url)) {
      var p = pending.get(url);
      pending.delete(url);   // the runtime reads each file once; let the bytes be freed afterwards
      return p.then(function (buf) { return new Response(buf, { status: 200 }); });
    }
    return origFetch(input, init);
  };
})();
