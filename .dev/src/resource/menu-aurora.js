"use strict";
"require baseclass";
"require ui";

return baseclass.extend({
  __init__() {
    ui.menu.load().then((tree) => this.render(tree));
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
      overlay.classList.remove("mobile-menu-open");
      document.body.classList.remove("mobile-navigation-open");
      document.body.style.overflow = "";
      this.resetNavigationGroups(mobileList);
    };

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
    this.renderModeMenu(tree);

    if (L.env.dispatchpath.length >= 3) {
      let node = tree;
      let url = "";

      for (let i = 0; i < 3 && node; i++) {
        const segment = L.env.dispatchpath[i];
        node = node.children?.[segment];
        url += (url ? "/" : "") + segment;
      }

      if (node) this.renderTabMenu(node, url);
    }
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
    const directClass = mobile
      ? "navigation-direct mobile-nav-link"
      : "navigation-direct nav-link";

    if (!item.hasChildren) {
      const attributes = {
        class: `${directClass}${item.isActivePage ? " is-active-page" : ""}`,
        href: item.href,
      };
      if (item.isActivePage) attributes["aria-current"] = "page";
      return E("li", { class: itemClass }, [E("a", attributes, [item.title])]);
    }

    const submenuId = this.navigationSubmenuId(mode, item.name);
    const groupClasses = [
      "navigation-group",
      mobile ? "mobile-nav-item" : "sidebar-group",
      item.isActiveGroup ? "is-active-group" : "",
      item.isActiveGroup ? "is-expanded" : "",
    ].filter(Boolean);
    const toggleAttributes = {
      class: mobile
        ? "navigation-group-toggle mobile-nav-link mobile-nav-toggle"
        : "navigation-group-toggle nav-category",
      type: "button",
      "aria-expanded": item.isActiveGroup ? "true" : "false",
      "aria-controls": submenuId,
    };
    if (item.isActiveGroup) toggleAttributes["aria-current"] = "location";

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
    const crumbEl = document.querySelector("#header-crumb");

    if (list) list.innerHTML = "";
    if (footer) footer.innerHTML = "";
    if (crumbEl) crumbEl.innerHTML = "";

    if (!list) return;

    const crumb = [];

    items.forEach((item) => {
      if (item.isActiveGroup || item.isActivePage) {
        crumb.push(item.title);
        // Same-named group/page pairs ("System › System") collapse to one
        // level — the duplicate adds no information.
        if (item.activePage && item.activePage.title !== item.title)
          crumb.push(item.activePage.title);
      }

      if (item.isLogout) {
        (footer || list).appendChild(
          E("a", { class: "nav-link", href: item.href }, [item.title]),
        );
        return;
      }

      list.appendChild(this.renderNavigationItem(item, "sidebar"));
    });

    this.bindNavigationAccordion(list);

    crumb.forEach((title, i) => {
      if (i) crumbEl?.appendChild(E("li", { class: "crumb-sep" }, ["›"]));
      crumbEl?.appendChild(
        E("li", { class: i === crumb.length - 1 ? "current" : "" }, [title]),
      );
    });
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
      // inherits the height, and the header's own transition-colors reads
      // the duration so the bar colour fades in lockstep with the wipe.
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
    }

    if (ul?.children.length > 1) {
      ul.style.display = "";
    }
  },
});
