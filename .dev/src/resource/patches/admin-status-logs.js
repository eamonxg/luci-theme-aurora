"use strict";
/* Aurora log viewer — enhances the read-only <textarea id="syslog"> on the
   System Log and Kernel Log pages (both under admin/status/logs/* on every
   supported release, so this one patch name covers them) into a parsed,
   column-aligned view. The textarea stays in the DOM as the data source:
   LuCI's own poll keeps rewriting its .value, which never fires events or
   mutations, so a cheap dirty-check interval re-reads it instead. When too
   few lines parse (PARSE_GATE), the enhancement tears itself down and the
   stock textarea shows again — the worst case is the styled status quo,
   never a garbled log. Node tests require() the parsing exports below. */
(function () {
  // RFC 5424 short names exactly as LuCI emits them. tools/views.js reads the
  // untranslated slot of its tables and ubox logread prints C-locale names, so
  // UI language never changes these. A line whose facility/severity falls
  // outside the whitelists is not a log format we know — shown raw, uncolored.
  const FACILITIES = new Set([
    "kern",
    "user",
    "mail",
    "daemon",
    "auth",
    "syslog",
    "lpr",
    "news",
    "uucp",
    "cron",
    "authpriv",
    "ftp",
    "ntp",
    "security",
    "console",
    "local0",
    "local1",
    "local2",
    "local3",
    "local4",
    "local5",
    "local6",
    "local7",
    "unknown",
  ]);
  const SEVERITIES = new Set([
    "emerg",
    "alert",
    "crit",
    "err",
    "warn",
    "notice",
    "info",
    "debug",
  ]);
  const SEV_CLASS = {
    emerg: "crit",
    alert: "crit",
    crit: "crit",
    err: "err",
    warn: "warn",
    notice: "notice",
    info: "info",
    debug: "debug",
  };
  // Below this parse-success ratio the value is not a log we understand
  // (syslog-ng replacement, future format change) — fall back to the textarea.
  const PARSE_GATE = 0.8;

  function splitTag(rest) {
    // `tag[pid]: msg` / `tag: msg`; tags with spaces (kernel's
    // "mt7921e 0000:01:00.0:") deliberately fail into plain msg.
    const m = rest.match(/^([A-Za-z0-9_.\/-]+(?:\[\d+\])?):\s+([\s\S]*)$/);
    return m ? { tag: m[1], msg: m[2] } : { tag: "", msg: rest };
  }

  /* System log line, two shapes:
     A (master RPC):      [<locale datestr>] fac.sev: tag[pid]: msg
     B (classic logread,  Www Mmm dd hh:mm:ss yyyy fac.sev tag[pid]: msg
        23.05 + 24.10 syslog-wrapper + master's RPC-failure fallback)
     Every captured token is kept verbatim — year, timezone, 12-hour clock,
     ctime's padded day, the colons — so rejoining the rendered fields with
     single spaces reproduces the source line byte for byte. The enhancement
     aligns and colors; it never rewrites. */
  function parseSyslogLine(line) {
    let m = line.match(/^\[(.+?)\]\s+(\w+)\.(\w+):\s+([\s\S]*)$/);
    if (m && FACILITIES.has(m[2]) && SEVERITIES.has(m[3]))
      return {
        time: `[${m[1]}]`,
        fac: m[2],
        sev: m[3],
        sevTok: `${m[2]}.${m[3]}:`,
        ...splitTag(m[4]),
      };
    m = line.match(
      /^(\w{3} \w{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}) (\w+)\.(\w+) ([\s\S]*)$/,
    );
    if (m && FACILITIES.has(m[2]) && SEVERITIES.has(m[3]))
      return {
        time: m[1],
        fac: m[2],
        sev: m[3],
        sevTok: `${m[2]}.${m[3]}`,
        ...splitTag(m[4]),
      };
    return null;
  }

  /* Kernel log line: `[   73412.882110] msg`. No severity survives into the
     text on any LuCI version (master runs `dmesg -r` and strips the <N>
     prefix after filtering on it; the classic pages never had it), and kernel
     messages have no uniform tag grammar — drivers print "name addr.dev
     port:", bare text, indented continuations — which is why upstream renders
     dmesg as plain unstyled text. A partial tag split styled only some lines
     and ate only their colons, so the message stays verbatim: time dimming
     and typography only. */
  function parseDmesgLine(line) {
    const m = line.match(/^(\[\s*\d+\.\d+\])\s?([\s\S]*)$/);
    if (!m) return null;
    return {
      time: m[1],
      fac: "",
      sev: "",
      sevTok: "",
      tag: "",
      msg: m[2],
    };
  }

  function evaluate(value, parseLine) {
    const lines = value ? value.split(/\n/) : [];
    const rows = lines.map((line) => ({ line, parsed: parseLine(line) }));
    const parsed = rows.reduce((n, r) => n + (r.parsed ? 1 : 0), 0);
    return { rows, ratio: rows.length ? parsed / rows.length : 1 };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseSyslogLine,
      parseDmesgLine,
      splitTag,
      evaluate,
      PARSE_GATE,
    };
  }
  if (typeof document === "undefined") return;

  // Kernel-log page under either menu layout: admin-status-dmesg on
  // 23.05/24.10, admin-status-logs-dmesg on master's combined Logs menu.
  // Read per mount: the router swaps pages without re-evaluating this file.
  let parseLine = parseSyslogLine;
  let timer = null;
  let arrival = null;

  let viewer = null;
  let lastValue = null;

  function span(cls, text, title) {
    const el = document.createElement("span");
    el.className = cls;
    el.textContent = text;
    if (title) el.title = title;
    return el;
  }

  function buildRow(entry) {
    const row = document.createElement("div");
    if (!entry.parsed) {
      row.className = "log-row";
      row.textContent = entry.line;
      return row;
    }
    const p = entry.parsed;
    row.className = "log-row" + (p.sev ? ` lv-${SEV_CLASS[p.sev]}` : "");
    // Real space text nodes between plain inline spans: the row wraps like
    // terminal output, and because every field renders verbatim (punctuation
    // included) a copied row is byte-identical to the source line.
    row.appendChild(span("log-time", p.time));
    if (p.sevTok) {
      row.appendChild(document.createTextNode(" "));
      row.appendChild(span("log-sev", p.sevTok));
    }
    if (p.tag) {
      row.appendChild(document.createTextNode(" "));
      row.appendChild(span("log-tag", p.tag + ":"));
    }
    row.appendChild(document.createTextNode(" "));
    row.appendChild(span("log-msg", p.msg));
    return row;
  }

  function selectionInside(el) {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed) return false;
    return el.contains(sel.anchorNode) || el.contains(sel.focusNode);
  }

  function teardown(container) {
    if (viewer) viewer.remove();
    viewer = null;
    container.classList.remove("log-enhanced");
  }

  function render(textarea, container, rows) {
    if (!viewer) {
      viewer = document.createElement("div");
      viewer.className = "syslog-view";
      // The stock textarea contained Ctrl+A for free — a focused form control
      // is its own selection context. A plain div is not (the standard switch,
      // user-select:contain, ships in no browser), so reproduce it: clicking
      // the log focuses the viewer, and select-all inside it stays inside it.
      viewer.tabIndex = 0;
      viewer.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
          e.preventDefault();
          const sel = window.getSelection();
          sel.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(viewer);
          sel.addRange(range);
        }
      });
      textarea.insertAdjacentElement("afterend", viewer);
      container.classList.add("log-enhanced");
    }
    const frag = document.createDocumentFragment();
    for (const entry of rows) frag.appendChild(buildRow(entry));
    viewer.replaceChildren(frag);
  }

  function tick() {
    const textarea = document.getElementById("syslog");
    const container = document.getElementById("content_syslog");
    if (!textarea || !container) return;
    const value = textarea.value;
    if (value === lastValue) return;
    // Re-rendering would destroy an in-progress selection; retry next tick.
    if (viewer && selectionInside(viewer)) return;
    lastValue = value;
    const { rows, ratio } = evaluate(value, parseLine);
    if (ratio >= PARSE_GATE) {
      // Tail-follow: a reader already pinned to the bottom stays pinned as new
      // lines arrive; any other scroll position is never touched. The content
      // area scrolls the window (main uses min-h, no inner scroller), and the
      // `viewer &&` guard keeps the first paint from jumping — same as stock.
      const follow =
        viewer &&
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 40;
      render(textarea, container, rows);
      if (follow) window.scrollTo(0, document.documentElement.scrollHeight);
    } else teardown(container);
  }

  function mount() {
    if (timer) return;
    const page = document.body?.dataset?.page || "";
    parseLine = /(^|-)dmesg(-|$)/.test(page) ? parseDmesgLine : parseSyslogLine;
    lastValue = null;
    // Content updates: LuCI's poll rewrites .value, which fires nothing — a
    // cheap dirty-check covers it.
    timer = setInterval(tick, 1000);
    // First paint: the view (and its textarea) is inserted asynchronously by
    // LuCI after this script runs. Element insertion IS an observable childList
    // mutation (unlike .value writes), and the callback runs as a microtask
    // before the browser paints the inserted textarea — so the viewer takes
    // over without a flash of the raw log.
    if (document.getElementById("syslog")) {
      tick();
    } else {
      arrival = new MutationObserver(function () {
        if (!document.getElementById("syslog")) return;
        arrival.disconnect();
        arrival = null;
        tick();
      });
      arrival.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  function unmount() {
    clearInterval(timer);
    timer = null;
    arrival?.disconnect();
    arrival = null;
    const container = document.getElementById("content_syslog");
    if (container) teardown(container);
    viewer = null;
  }

  // Page-scoped lifecycle for the router (see .dev/docs/router.md);
  // a full load simply mounts once.
  ((window.aurora ??= {}).patches ??= {})["admin-status-logs"] = {
    mount,
    unmount,
  };
  mount();
})();
