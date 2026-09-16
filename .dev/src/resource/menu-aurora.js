"use strict";
"require baseclass";
"require ui";

const PALETTE_RECENTS_KEY = "aurora.paletteRecents";

return baseclass.extend({
  __init__() {
    ui.menu
      .load()
      .then((tree) => this.render(tree))
      .finally(() => {
        // header.ut's replay stays inert until the live nav has replaced it
        // or failed to; either way it must not stay a dead copy.
        for (const el of document.querySelectorAll("[data-restored]"))
          el.inert = false;
      });
    this.initNavigationControls();
    this.initUciIndicator();
  },

  initUciIndicator() {
    const original = ui.changes?.setIndicator;
    if (!original) return;

    ui.changes.setIndicator = function (n) {
      original.call(this, n);
      document
        .querySelector('[data-indicator="uci-changes"]')
        ?.setAttribute("data-count", n || 0);
    };
  },

  initNavigationControls() {
    const overlay = document.querySelector("#mobile-menu-overlay");
    const navigationToggle = document.querySelector("#navigation-toggle");

    if (!navigationToggle || !overlay) return;

    const mobileList = overlay.querySelector("#mobile-nav-list");
    const desktop = window.matchMedia("(min-width: 768px)");
    const SIDEBAR_COLLAPSED_KEY = "aurora.sidebarCollapsed";

    const isDesktopSidebar = () =>
      desktop.matches && document.body.dataset.navType === "sidebar";

    const updateToggleState = (expanded) => {
      const desktopSidebar = isDesktopSidebar();

      // The hamburger ↔ X morph is a mobile-drawer affordance; the desktop
      // sidebar toggle stays a static hamburger (see 2026-06-11 redesign
      // spec, superseding the unified-toggle "always X when expanded" rule).
      navigationToggle.classList.toggle(
        "is-expanded",
        expanded && !desktop.matches,
      );
      navigationToggle.setAttribute(
        "aria-expanded",
        expanded ? "true" : "false",
      );
      navigationToggle.setAttribute(
        "aria-controls",
        desktopSidebar ? "sidebar-panel" : "mobile-menu-overlay",
      );

      const label = expanded && !desktopSidebar ? _("Close") : _("Navigation");

      navigationToggle.setAttribute("title", label);
      navigationToggle.setAttribute("aria-label", label);
    };

    const closeMobileNavigation = () => {
      if (!overlay.classList.contains("mobile-menu-open")) return;
      overlay.classList.remove("mobile-menu-open");
      document.body.classList.remove("mobile-navigation-open");
      document.body.style.overflow = "";
      this.resetNavigationGroups(mobileList);
      updateToggleState(false);
    };
    this.closeMobileNavigation = closeMobileNavigation;

    const getNavigationExpanded = () => {
      if (isDesktopSidebar()) {
        return !document.body.classList.contains("sidebar-collapsed");
      }

      return !desktop.matches && overlay.classList.contains("mobile-menu-open");
    };

    const setNavigationExpanded = (expanded) => {
      if (isDesktopSidebar()) {
        closeMobileNavigation();

        const collapsed = !expanded;

        // The column and the panel transition together (_layout.css).
        document.body.classList.toggle("sidebar-collapsed", collapsed);
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed);
        updateToggleState(expanded);
        return;
      }

      if (desktop.matches) {
        closeMobileNavigation();
        updateToggleState(false);
        return;
      }

      overlay.classList.toggle("mobile-menu-open", expanded);
      document.body.classList.toggle("mobile-navigation-open", expanded);
      document.body.style.overflow = expanded ? "hidden" : "";

      if (expanded) this.expandActiveNavigationGroup(mobileList);
      else this.resetNavigationGroups(mobileList);

      updateToggleState(expanded);
    };

    const toggleNavigation = () =>
      setNavigationExpanded(!getNavigationExpanded());

    const syncNavigationState = () => {
      closeMobileNavigation();

      if (isDesktopSidebar()) {
        const collapsed =
          localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
        document.body.classList.toggle("sidebar-collapsed", collapsed);
        updateToggleState(!collapsed);
        return;
      }

      updateToggleState(false);
    };

    navigationToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNavigation();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) setNavigationExpanded(false);
    });

    document.addEventListener("keydown", (e) => {
      if (
        e.key === "Escape" &&
        overlay.classList.contains("mobile-menu-open")
      ) {
        setNavigationExpanded(false);
      }
    });

    desktop.addEventListener("change", syncNavigationState);
    syncNavigationState();

    document.addEventListener("click", (e) => {
      const destination = e.target?.closest?.(
        ".navigation-direct, .navigation-sublink, .mobile-nav-logout",
      );

      if (destination && overlay.contains(destination)) {
        setNavigationExpanded(false);
      }
    });
  },

  renderMobileMenu(items) {
    const list = document.querySelector("#mobile-nav-list");
    const footerAction = document.querySelector("#mobile-nav-footer-action");

    if (list) list.innerHTML = "";
    if (footerAction) footerAction.innerHTML = "";

    if (!list) return;

    items.forEach((item) => {
      if (item.isLogout) {
        if (footerAction) {
          footerAction.appendChild(
            E("a", { class: "mobile-nav-logout", href: item.href }, [
              item.title,
            ]),
          );
        }
        return;
      }

      list.appendChild(this.renderNavigationItem(item, "mobile"));
    });

    this.bindNavigationAccordion(list);
  },

  render(tree) {
    this.tree = tree;
    this.renderModeMenu(tree);
    this.renderTabs(tree);
    this.cacheNav();
  },

  // Snapshot for header.ut's pre-paint replay, under the stamp it renders on
  // body; it recomputes the active marks, so one copy serves every page.
  cacheNav() {
    const html = {};
    for (const el of document.querySelectorAll(
      "#topmenu, #sidebar-list, #sidebar-footer",
    ))
      if (el.firstChild) html[el.id] = el.innerHTML;
    try {
      sessionStorage.setItem(
        "aurora.nav",
        JSON.stringify([document.body.dataset.navStamp, html]),
      );
    } catch {
      // No storage: the next load renders after the module, as before.
    }
  },

  renderTabs(tree) {
    if (L.env.dispatchpath.length < 3) return;

    let node = tree;
    let url = "";

    for (let i = 0; i < 3 && node; i++) {
      const segment = L.env.dispatchpath[i];
      node = node.children?.[segment];
      url += (url ? "/" : "") + segment;
    }

    if (node) this.renderTabMenu(node, url);
  },

  // Re-marks every nav surface from L.env after a same-document navigation
  // (router-aurora.js). Menus keep their DOM and listeners; only state moves.
  syncRoute() {
    if (!this.tree) return;

    const activeHref = new URL(
      L.url(...L.env.dispatchpath.slice(0, 3)),
      location.href,
    ).pathname;

    document
      .querySelectorAll(
        "#topmenu a, .desktop-menu-canvas a, #sidebar-list a, #mobile-nav-list a",
      )
      .forEach((a) => {
        const active =
          a.pathname === activeHref && !a.getAttribute("href").startsWith("#");
        a.classList.toggle("is-active-page", active);
        if (active) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });

    document.querySelectorAll(".navigation-group").forEach((group) => {
      const active = !!group.querySelector("a.is-active-page");
      const toggle = group.querySelector(".navigation-group-toggle");
      group.classList.toggle("is-active-group", active);
      if (active) toggle?.setAttribute("aria-current", "location");
      else toggle?.removeAttribute("aria-current");
    });

    for (const surface of [
      document.querySelector("#sidebar-list"),
      document.querySelector("#mobile-nav-list"),
    ]) {
      this.resetNavigationGroups(surface);
      this.expandActiveNavigationGroup(surface);
    }

    // header.ut's, shared with its pre-paint replay (sidebar mode only).
    window.auroraCrumb?.();

    const tabs = document.querySelector("#tabmenu");
    if (tabs) {
      tabs.innerHTML = "";
      tabs.style.display = "none";
    }
    this.renderTabs(this.tree);
  },

  closeSurfaces() {
    this.hideDesktopNav();
    if (this.paletteList) this.closePalette();
    this.closeMobileNavigation?.();
  },

  renderTabMenu(tree, url, level = 0) {
    const container = document.querySelector("#tabmenu");
    const ul = E("ul", { class: "tabs" });
    const children = ui.menu.getChildren(tree);
    let activeNode = null;

    children.forEach((child) => {
      const isActive = L.env.dispatchpath[3 + level] === child.name;

      ul.appendChild(
        E(
          "li",
          {
            class: `tabmenu-item-${child.name}${isActive ? " active" : ""}`,
          },
          [E("a", { href: L.url(url, child.name) }, [_(child.title)])],
        ),
      );

      if (isActive) activeNode = child;
    });

    if (!ul.children.length) return E([]);

    container.appendChild(ul);
    container.style.display = "";

    if (activeNode) {
      this.renderTabMenu(activeNode, `${url}/${activeNode.name}`, level + 1);
    }

    return ul;
  },

  renderMainMenu(tree, url, level = 0, navigationItems = null) {
    const ul = level
      ? E("ul", { class: "desktop-nav-list" })
      : document.querySelector("#topmenu");
    const children = ui.menu.getChildren(tree);

    if (level > 1) return E([]);

    if (level === 0) {
      const navType = document.body?.dataset?.navType || "mega-menu";

      if (navType === "sidebar") {
        this.renderSidebar(navigationItems || []);
        return ul || E([]);
      }

      // Drops header.ut's replayed copy, which carries no listeners.
      if (ul) ul.innerHTML = "";
      if (!ul || !children.length) return E([]);

      if (navType === "mega-menu") {
        this.initMegaMenu(children, url, ul);
      } else {
        this.initDropdown(children, url, ul);
      }
    } else {
      if (!children.length) return E([]);

      children.forEach((child) => {
        // Mark the current page so it gets the active pill — same vocabulary
        // as the top-level trigger (.menu-active). tree is the section node,
        // so tree.name is its dispatch segment.
        const isActive = this.isActivePath(tree.name, child.name);
        const attributes = {
          class: isActive ? "is-active-page" : "",
          href: L.url(url, child.name),
        };
        if (isActive) attributes["aria-current"] = "page";

        ul.appendChild(E("li", {}, [E("a", attributes, [_(child.title)])]));
      });
    }

    ul.style.display = "";
    return ul;
  },

  // page omitted/null => "is the current dispatch anywhere within this
  // top-level group"; page given => "is this exact page active".
  isActivePath(parent, page) {
    if (L.env.dispatchpath[1] !== parent) return false;

    return page == null || L.env.dispatchpath[2] === page;
  },

  buildNavigationModel(children, url) {
    return children
      .filter((child) => child?.name)
      .map((child) => {
        const pages = ui.menu
          .getChildren(child)
          .filter((page) => page?.name)
          .map((page) => ({
            name: page.name,
            title: _(page.title),
            href: L.url(url, child.name, page.name),
            isActivePage: this.isActivePath(child.name, page.name),
          }));
        const hasChildren = pages.length > 0;
        const isCurrentTopLevel = this.isActivePath(child.name);

        return {
          name: child.name,
          title: _(child.title),
          href: L.url(url, child.name),
          hasChildren,
          isLogout: child.name === "logout",
          isActiveGroup: hasChildren && isCurrentTopLevel,
          isActivePage: !hasChildren && isCurrentTopLevel,
          activePage: pages.find((page) => page.isActivePage) || null,
          pages,
        };
      });
  },

  navigationSubmenuId(mode, name) {
    return `${mode}-submenu-${encodeURIComponent(String(name))}`;
  },

  renderNavigationItem(item, mode) {
    const mobile = mode === "mobile";
    const itemClass = mobile ? "mobile-nav-item" : "";
    const directClass = "navigation-direct nav-row";

    if (!item.hasChildren) {
      const attributes = {
        class: `${directClass}${item.isActivePage ? " is-active-page" : ""}`,
        href: item.href,
      };
      if (item.isActivePage) attributes["aria-current"] = "page";
      // data-section keys the shared name → icon map (_nav.css); the icon
      // span renders it, unmapped names fall back at the consumer.
      attributes["data-section"] = item.name;
      return E("li", { class: itemClass }, [
        E("a", attributes, [
          E("span", { class: "nav-icon", "aria-hidden": "true" }),
          E("span", { class: "nav-label" }, [item.title]),
        ]),
      ]);
    }

    const submenuId = this.navigationSubmenuId(mode, item.name);
    const groupClasses = [
      "navigation-group",
      mobile ? "mobile-nav-item" : "sidebar-group",
      item.isActiveGroup ? "is-active-group" : "",
      item.isActiveGroup ? "is-expanded" : "",
    ].filter(Boolean);
    const toggleAttributes = {
      class: "navigation-group-toggle nav-row",
      type: "button",
      "aria-expanded": item.isActiveGroup ? "true" : "false",
      "aria-controls": submenuId,
    };
    if (item.isActiveGroup) toggleAttributes["aria-current"] = "location";
    // See the direct-row note: keys the shared icon map.
    toggleAttributes["data-section"] = item.name;

    const list = E("ul", {
      class: mobile
        ? "navigation-submenu-list mobile-nav-submenu-list"
        : "navigation-submenu-list sidebar-submenu",
    });
    item.pages.forEach((page) => {
      const linkAttributes = {
        class: [
          "navigation-sublink",
          mobile ? "mobile-nav-sublink" : "",
          page.isActivePage ? "is-active-page" : "",
        ]
          .filter(Boolean)
          .join(" "),
        href: page.href,
      };
      if (page.isActivePage) linkAttributes["aria-current"] = "page";
      list.appendChild(
        E("li", { class: mobile ? "mobile-nav-subitem" : "" }, [
          E("a", linkAttributes, [page.title]),
        ]),
      );
    });

    const regionAttributes = {
      class: mobile
        ? "navigation-group-region mobile-nav-submenu"
        : "navigation-group-region sidebar-section",
      id: submenuId,
      "aria-hidden": item.isActiveGroup ? "false" : "true",
    };
    if (!item.isActiveGroup) regionAttributes.inert = "";

    return E("li", { class: groupClasses.join(" ") }, [
      E("button", toggleAttributes, [
        E("span", { class: "nav-icon", "aria-hidden": "true" }),
        E("span", { class: "nav-category-label" }, [item.title]),
      ]),
      E("div", regionAttributes, [list]),
    ]);
  },

  setNavigationGroupExpanded(item, expanded) {
    const toggle = item.querySelector(".navigation-group-toggle");
    const region = item.querySelector(".navigation-group-region");

    item.classList.toggle("is-expanded", expanded);
    toggle?.setAttribute("aria-expanded", expanded ? "true" : "false");
    region?.setAttribute("aria-hidden", expanded ? "false" : "true");

    if (expanded) region?.removeAttribute("inert");
    else region?.setAttribute("inert", "");
  },

  setExclusiveNavigationGroupExpanded(surface, item, expanded) {
    if (!surface || !item) return;

    if (expanded) {
      surface
        .querySelectorAll(".navigation-group.is-expanded")
        .forEach((expandedItem) => {
          if (expandedItem !== item) {
            this.setNavigationGroupExpanded(expandedItem, false);
          }
        });
    }

    this.setNavigationGroupExpanded(item, expanded);
  },

  resetNavigationGroups(surface) {
    surface
      ?.querySelectorAll(".navigation-group.is-expanded")
      .forEach((item) => this.setNavigationGroupExpanded(item, false));
  },

  expandActiveNavigationGroup(surface) {
    const activeGroup = surface?.querySelector(
      ".navigation-group.is-active-group",
    );

    if (activeGroup) {
      this.setExclusiveNavigationGroupExpanded(surface, activeGroup, true);
    }
  },

  bindNavigationAccordion(surface) {
    if (!surface || surface.dataset.accordionBound === "true") return;

    surface.dataset.accordionBound = "true";
    surface.addEventListener("click", (event) => {
      const toggle = event.target?.closest?.(".navigation-group-toggle");
      const item = toggle?.closest?.(".navigation-group");

      if (!item || !surface.contains(item)) return;

      event.preventDefault();
      event.stopPropagation();
      this.setExclusiveNavigationGroupExpanded(
        surface,
        item,
        !item.classList.contains("is-expanded"),
      );
    });
  },

  renderSidebar(items) {
    const list = document.querySelector("#sidebar-list");
    const footer = document.querySelector("#sidebar-footer");

    if (list) list.innerHTML = "";
    if (footer) footer.innerHTML = "";

    if (!list) return;

    items.forEach((item) => {
      if (item.isLogout) {
        (footer || list).appendChild(
          E("a", { class: "nav-link", href: item.href }, [item.title]),
        );
        return;
      }

      list.appendChild(this.renderNavigationItem(item, "sidebar"));
    });

    this.bindNavigationAccordion(list);
    window.auroraCrumb?.();
  },

  // Command palette (all nav types): a Spotlight-style panel on ⌘K / Ctrl+K
  // or the header trigger, holding routes and theme-mode commands. The index
  // is the navigation model the menus already render from — no extra
  // requests, no DOM scraping — and the panel DOM is built lazily on first
  // open, so pages where it is never used pay nothing beyond this flat array.
  initPalette(items, root) {
    const toggle = document.querySelector("#cmdk-trigger");
    if (!toggle || this.paletteIndex) return;

    this.paletteIndex = [];
    this.paletteAliases = {};
    let logout = null;
    items.forEach((item) => {
      if (item.isLogout) {
        logout = item;
        return;
      }
      if (!item.hasChildren) {
        this.paletteIndex.push({
          title: item.title,
          name: item.name,
          group: null,
          href: item.href,
        });
        return;
      }
      item.pages.forEach((page) => {
        // Dispatch paths keep English segments matchable under any UI
        // language.
        const name = `${item.name}/${page.name}`;
        // The raw node: getChildren() hands out alias nodes carrying their
        // target's children, which would hide an alias parent's tabs.
        const node = root?.children?.[item.name]?.children?.[page.name] ?? {};
        const tabs = ui.menu.getChildren(node);
        const type = node.action?.type;
        const target =
          type === "alias"
            ? node.action.path.replace(`${root.name}/${name}/`, "")
            : type === "firstchild" &&
              tabs.find((tab) => !tab.firstchild_ineligible)?.name;

        // A parent that only redirects to one of its tabs is that tab; its
        // row gives way to the tabs, and its name (stored by older recents)
        // resolves to where it redirects.
        if (tabs.some((tab) => tab.name === target))
          this.paletteAliases[name] = `${name}/${target}`;
        else
          this.paletteIndex.push({
            title: page.title,
            name,
            group: item.title,
            href: page.href,
          });

        tabs.forEach((tab) =>
          this.paletteIndex.push({
            title: _(tab.title),
            parent: page.title,
            name: `${name}/${tab.name}`,
            group: item.title,
            href: L.url(root.name, item.name, page.name, tab.name),
          }),
        );
      });
    });

    // The only non-navigation commands: theme modes. They ride the same
    // index — matched and rendered like pages, grouped under _("Design")
    // (the System → Language and Style label) — but execute header.ut's
    // global setTheme() instead of navigating, so the panel stays open and
    // previews the switch live. luci-base carries no mode msgids, so the
    // labels borrow luci-app-aurora-config's already-translated "Light
    // Mode"/"Dark Mode" — matching its msgids verbatim is what makes the
    // palette follow the UI language wherever the config app is installed,
    // and they fall back to English where it isn't.
    [
      ["light", _("Light Mode")],
      ["dark", _("Dark Mode")],
      ["device", _("Automatic")],
    ].forEach(([mode, title]) =>
      this.paletteIndex.push({
        title,
        name: `theme ${mode}`,
        group: _("Design"),
        mode,
      }),
    );

    // Logout is a command, not a destination: it rides ">" only (last, after
    // the modes), stays out of the plain browse list, and is never recorded
    // as a recent — but a typed query still reaches it.
    if (logout)
      this.paletteIndex.push({
        title: logout.title,
        name: logout.name,
        group: null,
        href: logout.href,
        isLogout: true,
      });

    // Only msgids that already exist in a shipped catalog (luci-base, or the
    // config app's as above) are used — the theme intentionally ships no
    // translations of its own.
    const isMac = /Mac|iP(ad|hone|od)/.test(navigator.platform);
    this.paletteKey = isMac ? "⌘K" : "Ctrl+K";
    toggle.setAttribute("aria-keyshortcuts", isMac ? "Meta+K" : "Control+K");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => this.togglePalette());
    this.paletteTrigger = toggle;

    document.addEventListener("keydown", (e) => {
      // An IME swallows these keys while composing (Esc cancels the
      // composition, not the panel); keyCode 229 covers engines that
      // don't set isComposing on the trailing keydown.
      if (e.isComposing || e.keyCode === 229) return;
      // Platform-exact modifier — only the advertised shortcut, with every
      // other modifier rejected so combinations like Ctrl+Cmd+K fall through.
      // On macOS, Ctrl+K is kill-to-end-of-line in text fields and must keep
      // working.
      if (
        (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key || "").toLowerCase() === "k"
      ) {
        e.preventDefault();
        this.togglePalette();
      } else if (
        e.key === "Escape" &&
        this.palettePanel &&
        !this.palettePanel.hidden
      ) {
        this.closePalette();
      }
    });

    // Registered only while the panel is open (see openPalette/closePalette).
    this.onPaletteAway = (e) => {
      if (!this.palettePanel.contains(e.target) && !toggle.contains(e.target))
        this.closePalette();
    };
  },

  buildPalette() {
    // type=text, not search: WebKit's search variant draws its own clear
    // glyph at its own weight, which reads foreign next to the theme's
    // Tabler set (and Firefox draws none at all) — .cmdk-clear below is the
    // themed replacement, matching luci-theme-shadcn's palette. The combobox
    // wiring (with role=option rows) is what makes arrow-key selection
    // audible to screen readers — visually it's CSS-only .is-selected.
    const input = E("input", {
      class: "cmdk-input",
      type: "text",
      enterkeyhint: "go",
      placeholder: _("Type to filter…"),
      "aria-label": _("Type to filter…"),
      autocomplete: "off",
      spellcheck: "false",
      role: "combobox",
      "aria-expanded": "true",
      "aria-autocomplete": "list",
      "aria-controls": "cmdk-list",
    });
    const results = E("div", {
      class: "cmdk-list",
      id: "cmdk-list",
      role: "listbox",
    });
    // Visibility is CSS-only (:placeholder-shown on the input), so nothing
    // here has to mirror the query state.
    const clear = E("button", {
      class: "cmdk-clear",
      type: "button",
      "aria-label": _("Clear"),
    });
    clear.addEventListener("click", () => {
      input.value = "";
      this.renderPaletteResults("");
      input.focus();
    });
    // Mobile-only exit (the full-screen takeover leaves no outside to tap
    // and touch devices have no Escape) — hidden on md+ via CSS.
    const cancel = E("button", { class: "cmdk-cancel", type: "button" }, [
      _("Cancel"),
    ]);
    cancel.addEventListener("click", () => this.closePalette());
    const panel = E(
      "div",
      {
        id: "cmdk-panel",
        class: "cmdk-panel",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": _("Navigation"),
        hidden: "",
      },
      [
        E("div", { class: "cmdk-inputrow" }, [input, clear, cancel]),
        results,
        E("div", { class: "cmdk-footer" }, [
          E("kbd", {}, ["↑↓"]),
          E("kbd", {}, ["↵"]),
          E("kbd", {}, [">"]),
          E("kbd", {}, ["esc"]),
          E("span", { class: "cmdk-hint-close" }, [
            E("kbd", {}, [this.paletteKey]),
          ]),
        ]),
      ],
    );

    input.addEventListener("input", () =>
      this.renderPaletteResults(input.value),
    );
    input.addEventListener("keydown", (e) => {
      // Mid-composition these keys belong to the IME: Enter commits the
      // buffer (navigating away for pinyin users) and arrows move inside
      // the candidate list, not the results.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.movePaletteSelection(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        results.querySelector(".is-selected")?.click();
      }
    });
    // mousemove, not mouseover: scrollIntoView() slides rows under a
    // stationary pointer, which fires mouseover and would snap the
    // selection back to whatever the mouse happens to rest on.
    results.addEventListener("mousemove", (e) => {
      const row = e.target?.closest?.(".cmdk-row");
      if (row && !row.classList.contains("is-selected"))
        this.setPaletteSelection(row);
    });
    // Theme rows execute instead of navigate: hand the mode to header.ut's
    // global setTheme/syncSwitchers, keep the panel open so the switch
    // previews live, and re-render so the ✓ follows. Refocus the input —
    // the clicked anchor is replaced by the re-render, which would strand
    // focus on <body> with the dialog still open.
    results.addEventListener("click", (e) => {
      const row = e.target?.closest?.(".cmdk-row");
      if (!row) return;
      const mode = row.dataset.mode;
      if (!mode) {
        // Navigation rows: remember the pick, then let the click navigate
        // (same-document router or full load) untouched.
        if (row.dataset.name) this.recordPaletteRecent(row.dataset.name);
        return;
      }
      e.preventDefault();
      setTheme(mode);
      syncSwitchers();
      this.renderPaletteResults(input.value);
      this.setPaletteSelection(results.querySelector(`[data-mode="${mode}"]`));
      input.focus();
    });
    // The dialog is modal (full-screen takeover on mobile): keep Tab
    // cycling within it instead of escaping onto the page beneath.
    panel.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusables = [
        input,
        clear,
        ...results.querySelectorAll("a"),
        cancel,
      ].filter((el) => el.getClientRects().length);
      const edge = e.shiftKey ? focusables[0] : focusables.at(-1);
      if (document.activeElement === edge) {
        e.preventDefault();
        (e.shiftKey ? focusables.at(-1) : focusables[0]).focus();
      }
    });

    document.body.appendChild(panel);
    this.paletteTrigger.setAttribute("aria-controls", panel.id);
    this.palettePanel = panel;
    this.paletteInput = input;
    this.paletteList = results;
  },

  // Greedy left-to-right subsequence scorer: adjacency runs and word starts
  // score up, longer targets score down. Retried from every occurrence of
  // the query's first character — a single greedy pass would anchor "dns"
  // to the first d of "Dhcp and dNS" and scatter, scoring it below shorter
  // near-misses like "Diagnostics". Query arrives lowercased; spaces only
  // reset the adjacency run.
  fuzzyMatch(q, text) {
    const low = String(text).toLowerCase();
    let best = null;

    for (
      let from = low.indexOf(q[0]);
      from >= 0;
      from = low.indexOf(q[0], from + 1)
    ) {
      let ti = from;
      let score = 0;
      let run = 0;
      const ranges = [];

      for (const c of q) {
        if (c === " ") {
          run = 0;
          continue;
        }
        const at = low.indexOf(c, ti);
        if (at < 0) {
          ranges.length = 0;
          break;
        }

        run = at === ti && ranges.length ? run + 1 : 1;
        score +=
          1 +
          run +
          (at === ti && ranges.length ? 4 : 0) +
          (at === 0 || low[at - 1] === " " || low[at - 1] === "/" ? 3 : 0);

        // c is a code point, so it can be two UTF-16 units wide (emoji, CJK
        // Ext-B); advancing by c.length keeps the ranges — which index the
        // original string — from slicing a surrogate pair in half.
        const end = at + c.length;
        const last = ranges[ranges.length - 1];
        if (last && last[1] === at) last[1] = end;
        else ranges.push([at, end]);
        ti = end;
      }

      score -= low.length * 0.02;
      if (ranges.length && (!best || score > best.score))
        best = { score, ranges };
    }

    return best;
  },

  // localStorage can be unavailable (privacy modes) or hold anything after
  // a downgrade — both read as "no history". No size cap: dedupe bounds the
  // list by the pages actually visited, i.e. the menu's own scale.
  readPaletteRecents() {
    try {
      const list = JSON.parse(localStorage.getItem(PALETTE_RECENTS_KEY));
      if (!Array.isArray(list)) return [];
      return [
        ...new Set(
          list
            .filter((name) => typeof name === "string")
            .map((name) => this.paletteAliases?.[name] ?? name),
        ),
      ];
    } catch {
      return [];
    }
  },

  recordPaletteRecent(name) {
    try {
      localStorage.setItem(
        PALETTE_RECENTS_KEY,
        JSON.stringify([
          name,
          ...this.readPaletteRecents().filter((kept) => kept !== name),
        ]),
      );
    } catch {
      // History is decorative; a sealed or full store just means none.
    }
  },

  // Pure LRU: every visited page floats, so long use converges on a fully
  // most-recently-used browse order (Sublime's model). Names that vanished
  // from the menu (ACL change, package removed) drop out here; command rows
  // never float, whatever the store says.
  paletteBrowseRecents() {
    return this.readPaletteRecents().filter((name) =>
      this.paletteIndex.some(
        (page) => page.name === name && !page.mode && !page.isLogout,
      ),
    );
  },

  // Empty query matches everything at score 0 (the browse list). Title hits
  // rank first, then parent hits, which score the parent alone so its tabs
  // tie and keep menu order; "parent title" pairs split on a space. Then the
  // path, then the group.
  matchPaletteEntry(q, page) {
    if (!q) return { score: 0, ranges: null };

    const title = this.fuzzyMatch(q, page.title);
    if (title) return { score: title.score + 12, ranges: title.ranges };

    if (page.parent) {
      const parent = this.fuzzyMatch(q, page.parent);
      if (parent)
        return {
          score: parent.score + 8,
          ranges: null,
          parentRanges: parent.ranges,
        };

      const words = q.split(/\s+/);
      for (let i = 1; i < words.length; i++) {
        const head = this.fuzzyMatch(words.slice(0, i).join(" "), page.parent);
        const tail =
          head && this.fuzzyMatch(words.slice(i).join(" "), page.title);
        if (tail)
          return {
            score: head.score + tail.score + 8,
            ranges: tail.ranges,
            parentRanges: head.ranges,
          };
      }
    }

    const rest =
      this.matchPalettePath(q, page.name) ||
      (page.group ? this.fuzzyMatch(q, page.group) : null);
    return rest && { score: rest.score, ranges: null };
  },

  // Each query word (split on spaces or "/") lands inside one segment, in
  // path order: "network wireless" reaches network/wireless, while a lone
  // word can't scatter across segments ("ssh" in services/passwall2/other).
  matchPalettePath(q, name) {
    const words = q.split(/[\s/]+/).filter(Boolean);
    const segments = name.split("/");
    let at = 0;
    let score = 0;

    for (const word of words) {
      let hit = null;
      for (; at < segments.length; at++) {
        hit = this.fuzzyMatch(word, segments[at]);
        if (hit) break;
      }
      if (!hit) return null;
      score += hit.score;
    }
    return words.length ? { score } : null;
  },

  collectPaletteMatches(value) {
    let q = value.trim().toLowerCase();
    // A leading ">" scopes the list to the command rows (the prototype's
    // command-only mode); "＞" covers CJK IMEs emitting the full-width form.
    const cmdOnly = q[0] === ">" || q[0] === "＞";
    if (cmdOnly) q = q.slice(1).trim();
    // Browsing floats the recently opened pages; recency rides the same
    // stable sort as fuzzy rank, so ties keep menu order and typed queries
    // (which leave recents empty) stay pure fuzzy.
    const recents = q || cmdOnly ? [] : this.paletteBrowseRecents();
    const matches = [];

    for (const page of this.paletteIndex) {
      if (cmdOnly && !page.mode && !page.isLogout) continue;
      if (page.isLogout && !cmdOnly && !q) continue;
      const m = this.matchPaletteEntry(q, page);
      if (!m) continue;
      const at = recents.indexOf(page.name);
      matches.push({
        page,
        score: at < 0 ? m.score : recents.length - at,
        ranges: m.ranges,
        parentRanges: m.parentRanges,
      });
    }
    if (q || recents.length) matches.sort((a, b) => b.score - a.score);
    return matches;
  },

  renderPaletteResults(value) {
    const matches = this.collectPaletteMatches(value);
    const theme = localStorage.getItem("aurora.theme") || "device";

    this.paletteInput.removeAttribute("aria-activedescendant");
    this.paletteList.replaceChildren();

    if (!matches.length) {
      this.paletteList.appendChild(
        E("div", { class: "cmdk-empty" }, [_("No entries available")]),
      );
      return;
    }

    matches.forEach(({ page, ranges, parentRanges }, i) => {
      const current = page.mode && page.mode === theme;
      const attributes = {
        class: "cmdk-row",
        id: `cmdk-option-${i}`,
        role: "option",
        "aria-selected": "false",
        href: page.href || "#",
      };
      if (page.mode) attributes["data-mode"] = page.mode;
      else if (!page.isLogout) attributes["data-name"] = page.name;
      if (current) attributes["aria-current"] = "true";

      this.paletteList.appendChild(
        E("a", attributes, [
          E(
            "span",
            { class: "cmdk-title" },
            // A tab named after its parent is the page the parent opens.
            page.parent && page.parent !== page.title
              ? [
                  E(
                    "span",
                    { class: "cmdk-parent" },
                    this.highlightPaletteMatch(page.parent, parentRanges),
                  ),
                  E(
                    "span",
                    { class: "cmdk-label" },
                    this.highlightPaletteMatch(page.title, ranges),
                  ),
                ]
              : this.highlightPaletteMatch(page.title, ranges),
          ),
          current
            ? // The ✓ is decorative (aria-current carries the state); mark
              // reuses the highlight colour without any new CSS.
              E("span", { class: "cmdk-group-name", "aria-hidden": "true" }, [
                E("mark", {}, ["✓"]),
              ])
            : page.group
              ? E("span", { class: "cmdk-group-name" }, [page.group])
              : "",
        ]),
      );
    });

    this.setPaletteSelection(this.paletteList.firstChild);
  },

  highlightPaletteMatch(title, ranges) {
    // Ranges were measured on the lowercased copy; case folding can change
    // string length ("İ" → "i̇"), skewing offsets into the original — skip
    // highlighting rather than mis-slice.
    if (!ranges || title.toLowerCase().length !== title.length) return [title];

    const parts = [];
    let last = 0;
    ranges.forEach(([from, to]) => {
      parts.push(
        title.slice(last, from),
        E("mark", {}, [title.slice(from, to)]),
      );
      last = to;
    });
    parts.push(title.slice(last));
    return parts;
  },

  setPaletteSelection(row) {
    const prev = this.paletteList.querySelector(".is-selected");
    prev?.classList.remove("is-selected");
    prev?.setAttribute("aria-selected", "false");
    row.classList.add("is-selected");
    row.setAttribute("aria-selected", "true");
    this.paletteInput.setAttribute("aria-activedescendant", row.id);
  },

  movePaletteSelection(delta) {
    const rows = [...this.paletteList.querySelectorAll(".cmdk-row")];
    if (!rows.length) return;

    const current = rows.findIndex((row) =>
      row.classList.contains("is-selected"),
    );
    const next = rows[(current + delta + rows.length) % rows.length];

    this.setPaletteSelection(next);
    next.scrollIntoView({ block: "nearest" });
  },

  togglePalette() {
    if (!this.palettePanel) this.buildPalette();

    if (this.palettePanel.hidden) this.openPalette();
    else this.closePalette();
  },

  openPalette() {
    this.paletteReturnFocus = document.activeElement;
    this.paletteTrigger.setAttribute("aria-expanded", "true");
    this.palettePanel.hidden = false;
    this.paletteInput.value = "";
    this.renderPaletteResults("");
    this.paletteInput.focus();
    document.addEventListener("pointerdown", this.onPaletteAway);
  },

  closePalette() {
    this.paletteTrigger.setAttribute("aria-expanded", "false");
    this.palettePanel.hidden = true;
    document.removeEventListener("pointerdown", this.onPaletteAway);
    if (this.paletteReturnFocus?.isConnected) this.paletteReturnFocus.focus();
    this.paletteReturnFocus = null;
  },

  // Shared scaffolding for the two desktop dropdown modes (mega-menu and
  // dropdown): builds the top-level `.menu` link + its `.desktop-nav`
  // panel. Hover/activation behaviour differs per mode and is wired by the
  // caller on the returned nodes.
  buildDropdownItem(child, url, ul) {
    const submenu = ui.menu.getChildren(child);
    const hasSubmenu = submenu.length > 0;

    const li = E("li", {}, [
      E(
        "a",
        {
          class: "menu",
          href: hasSubmenu ? "#" : L.url(url, child.name),
        },
        [_(child.title)],
      ),
    ]);

    ul.appendChild(li);

    const menuLink = li.querySelector("a");
    let nav = null;

    if (hasSubmenu) {
      const list = this.renderMainMenu(child, `${url}/${child.name}`, 1);
      const children = [list];

      if (document.body?.dataset?.navType === "mega-menu") {
        // Constant canvas: links fill top-to-bottom. Base column count is 4;
        // more items grow the row count, not the width, so the list stays
        // inside the three-column canvas middle track.
        list.style.setProperty(
          "--menu-rows",
          Math.max(6, Math.ceil(submenu.length / 4)),
        );
        // data-section keys the first-level icon off the node name (stable,
        // language-independent) — see the .desktop-nav-title[data-section]
        // map in _nav.css. Unmapped names fall back to the default icon via
        // var(--menu-icon, …).
        children.unshift(
          E("div", { class: "desktop-nav-anchor" }, [
            E(
              "span",
              { class: "desktop-nav-title", "data-section": child.name },
              [_(child.title)],
            ),
          ]),
        );
        // Right column: clone the server-rendered device board into each
        // panel so the grid can lay it out as the third track. The original
        // stays hidden as the template (see _layout.css).
        const board = document.querySelector(
          ".desktop-menu-container > .desktop-menu-board",
        );
        if (board) children.push(board.cloneNode(true));
      }

      nav = E("div", { class: "desktop-nav" }, children);
      li.appendChild(nav);
      menuLink.addEventListener("click", (e) => e.preventDefault());
    }

    return { li, nav, menuLink, hasSubmenu };
  },

  // Deactivate every open dropdown except the given one. Pass null for both
  // to close all (used by hideDesktopNav).
  deactivateDesktopNavExcept(nav, menuLink) {
    document.querySelectorAll(".desktop-nav").forEach((n) => {
      if (n !== nav) n.classList.remove("active");
    });
    document.querySelectorAll("#topmenu a").forEach((a) => {
      if (a !== menuLink) a.classList.remove("menu-active");
    });
  },

  initMegaMenu(children, url, ul) {
    const container = document.querySelector(".desktop-menu-container");
    const canvas = container?.querySelector(".desktop-menu-canvas");
    const overlay = document.querySelector(".desktop-menu-overlay");
    const header = document.querySelector("header");

    if (!header || !overlay) return;

    let showTimer = null;
    let hideTimer = null;

    // Constant canvas: every category opens at the same height — the
    // tallest submenu wins. --mega-menu-height is that panel height alone
    // (the visible travel; the bar is not part of the wipe distance).
    // Pre-measured at idle (after fonts settle) so the first hover pays no
    // synchronous reflow, and cached, so switching categories is a pure
    // cross-fade with zero layout work. The height stays set across
    // open/close — it is the sheet's translate reference, not the animated
    // property. A resize invalidates the cache.
    let canvasHeight = 0;
    let revealDuration = 300;

    const applyCanvasHeight = () => {
      if (!canvasHeight) {
        header
          .querySelectorAll(".desktop-nav")
          .forEach(
            (nav) => (canvasHeight = Math.max(canvasHeight, nav.offsetHeight)),
          );
        // apple.com's flyout pacing: a constant 2px/ms over the visible
        // travel, clamped to 240–480ms. Short panels open snappily, tall
        // ones don't blink.
        revealDuration = Math.min(
          480,
          Math.max(240, Math.round(canvasHeight / 2)),
        );
      }
      // Both vars live on the header, not the container: the container
      // inherits both, and the close fallback timer reads the duration
      // back off the header (the bar itself must stay transition-free so
      // theme flips repaint it in the same frame as the page).
      header.style.setProperty("--mega-menu-height", `${canvasHeight}px`);
      header.style.setProperty("--mega-menu-duration", `${revealDuration}ms`);
    };

    // Re-measure on resize even while closed — leaving the cache cold would
    // push the reflow back onto the next hover's open path.
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      canvasHeight = 0;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyCanvasHeight, 150);
    });

    // Pointer trajectory: keep a sample from ~60ms ago so a pill's mouseenter
    // can tell whether the cursor is diving down into the open panel (heading
    // for a submenu link) versus scanning along the pill row. Diving across
    // the row would otherwise hijack the open category on every pill it grazes.
    let agedPos = { x: 0, y: 0 };
    let agedAt = 0;
    let livePos = { x: 0, y: 0 };
    header.addEventListener("mousemove", (e) => {
      if (e.timeStamp - agedAt > 60) {
        agedPos = livePos;
        agedAt = e.timeStamp;
      }
      livePos = { x: e.clientX, y: e.clientY };
    });

    // menu-aim / "safe area": instead of the cursor's instantaneous slope
    // (which reads near-horizontal exactly when it grazes the neighbouring
    // pills at the very start of a dive), project the travel vector forward and
    // ask whether it lands inside the OPEN panel. If the user is aiming at a
    // submenu link — even the far top-left one, reached by a shallow diagonal
    // across other pills — the projection falls within the panel rect, so we
    // hold the current category instead of letting each grazed pill hijack it.
    const isAimingIntoOpenPanel = () => {
      const openNav = header.querySelector(".desktop-nav.active");
      if (!openNav) return false;

      const vx = livePos.x - agedPos.x;
      const vy = livePos.y - agedPos.y;
      if (vy <= 2) return false; // horizontal / upward → a deliberate switch

      const rect = openNav.getBoundingClientRect();
      if (livePos.y >= rect.top) return true; // already descending into it

      // Where the current heading crosses the panel's top edge.
      const xAtTop = livePos.x + (vx * (rect.top - livePos.y)) / vy;
      return xAtTop >= rect.left - 24 && xAtTop <= rect.right + 24;
    };

    children.forEach((child) => {
      const { li, nav, menuLink, hasSubmenu } = this.buildDropdownItem(
        child,
        url,
        ul,
      );
      if (!hasSubmenu) return;

      // Reparent the panel into the counter-transformed canvas: the
      // transformed #topmenu would otherwise become the containing block of
      // the absolutely-positioned panel and shrink the canvas to the menu's
      // width. Inside the canvas the panel rides the sheet's compositor
      // reveal (and is clipped by the sheet's overflow) for free.
      if (canvas) canvas.appendChild(nav);

      li.addEventListener("mouseenter", () => {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }

        // First open waits for hover intent. Once open, scanning the pill row
        // switches instantly (Apple's flyout-change feel), but a cursor diving
        // diagonally toward a submenu link must NOT hijack every pill it grazes
        // — so while diving we fall back to a short intent dwell that a quick
        // pass-through cancels via mouseleave before it ever fires.
        const isOpen = container?.classList.contains("active");
        const delay = !isOpen ? 100 : isAimingIntoOpenPanel() ? 260 : 0;

        showTimer = setTimeout(() => {
          const wasActive = nav.classList.contains("active");

          this.deactivateDesktopNavExcept(nav, menuLink);

          if (wasActive) return;

          menuLink.classList.add("menu-active");

          if (container) {
            applyCanvasHeight();
            container.dataset.closeToken = "";
            container.classList.add("active");
            container.classList.remove("closing");
            overlay.classList.add("active");
          }
          nav.classList.add("active");
        }, delay);
      });

      li.addEventListener("mouseleave", () => {
        if (showTimer) {
          clearTimeout(showTimer);
          showTimer = null;
        }
      });
    });

    // Pre-measure the canvas off the interaction path: fonts change panel
    // heights, so wait for them, then measure when the main thread is idle.
    // A hover that beats this still falls back to the lazy measure above.
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
    (document.fonts?.ready || Promise.resolve()).then(() =>
      idle(() => {
        if (!canvasHeight) applyCanvasHeight();
      }),
    );

    const hideMenu = () => {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }

      hideTimer = setTimeout(() => {
        this.hideDesktopNav();
      }, 150);
    };

    header.addEventListener("mouseleave", hideMenu);
    overlay.addEventListener("mouseenter", hideMenu);

    header.addEventListener("mouseenter", () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    });

    overlay.addEventListener("click", () => this.hideDesktopNav());
  },

  initDropdown(children, url, ul) {
    children.forEach((child) => {
      const { li, nav, menuLink, hasSubmenu } = this.buildDropdownItem(
        child,
        url,
        ul,
      );
      if (!hasSubmenu) return;

      let showTimer = null;
      let hideTimer = null;

      li.addEventListener("mouseenter", () => {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }

        showTimer = setTimeout(() => {
          this.deactivateDesktopNavExcept(nav, menuLink);
          menuLink.classList.add("menu-active");
          nav.classList.add("active");
        }, 100);
      });

      li.addEventListener("mouseleave", () => {
        if (showTimer) {
          clearTimeout(showTimer);
          showTimer = null;
        }

        hideTimer = setTimeout(() => {
          nav.classList.remove("active");
          menuLink.classList.remove("menu-active");
        }, 150);
      });
    });
  },

  // Only ever called from mega-menu mode (the dropdown closes itself
  // per-item on mouseleave), so it always performs the mega-menu cleanup.
  hideDesktopNav() {
    this.deactivateDesktopNavExcept(null, null);

    const container = document.querySelector(".desktop-menu-container");
    document.querySelector(".desktop-menu-overlay")?.classList.remove("active");

    if (!container) return;
    if (
      !container.classList.contains("active") &&
      !container.classList.contains("closing")
    )
      return;

    // Retract the curtain: removing `.active` sends the sheet back to
    // translateY(-100%) and the canvas to its counter-position — the drawer
    // close, run entirely on the compositor. --mega-menu-height stays put;
    // it is the translate reference, not the animated property. `.closing`
    // keeps the container in the tree only while its opacity fades out and
    // the sheet returns to the closed translate position.
    container.classList.add("closing");
    container.classList.remove("active");

    const sheet = container.querySelector(".desktop-menu-sheet");
    const closeToken = `${Date.now()}-${Math.random()}`;
    container.dataset.closeToken = closeToken;

    let closeFallback = null;
    const finishClosing = (event) => {
      if (event?.target && event.target !== sheet) return;
      if (container.dataset.closeToken !== closeToken) {
        if (closeFallback !== null) {
          clearTimeout(closeFallback);
          closeFallback = null;
        }
        sheet?.removeEventListener("transitionend", finishClosing);
        return;
      }
      if (closeFallback !== null) {
        clearTimeout(closeFallback);
        closeFallback = null;
      }

      sheet?.removeEventListener("transitionend", finishClosing);

      if (!container.classList.contains("active")) {
        container.classList.remove("closing");
        delete container.dataset.closeToken;
      }
    };

    if (
      !sheet ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      finishClosing();
      return;
    }

    sheet.addEventListener("transitionend", finishClosing);
    // The retract duration is distance-adaptive (see applyCanvasHeight);
    // read it back so the safety net always outlasts the real transition.
    const duration =
      parseInt(
        document
          .querySelector("header")
          ?.style.getPropertyValue("--mega-menu-duration"),
      ) || 300;
    closeFallback = setTimeout(finishClosing, duration + 50);
  },

  renderModeMenu(tree) {
    const ul = document.querySelector("#modemenu");
    const children = ui.menu.getChildren(tree);
    let activeChild = null;

    children.forEach((child, index) => {
      const isActive = L.env.requestpath.length
        ? child.name === L.env.requestpath[0]
        : index === 0;

      if (ul) {
        ul.appendChild(
          E(
            "li",
            {
              class: isActive ? "active" : "",
            },
            [E("a", { href: L.url(child.name) }, [_(child.title)])],
          ),
        );
      }

      if (isActive) activeChild = child;
    });

    if (activeChild) {
      const navigationItems = this.buildNavigationModel(
        ui.menu.getChildren(activeChild),
        activeChild.name,
      );
      this.renderMainMenu(activeChild, activeChild.name, 0, navigationItems);
      this.renderMobileMenu(navigationItems);
      this.initPalette(navigationItems, activeChild);
    }

    if (ul?.children.length > 1) {
      ul.style.display = "";
    }
  },
});
