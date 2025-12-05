"use strict";
"require baseclass";
"require ui";

return baseclass.extend({
  __init__() {
    ui.menu.load().then((tree) => this.render(tree));
    this.initMobileMenu();
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

  initMobileMenu() {
    const overlay = document.querySelector("#mobile-menu-overlay");
    const menuToggle = document.querySelector("#mobile-menu-btn");
    const closeBtn = document.querySelector("#mobile-nav-close");

    if (!menuToggle || !overlay) return;

    menuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = overlay.classList.contains("mobile-menu-open");

      overlay.classList.toggle("mobile-menu-open", !isOpen);
      menuToggle.classList.toggle("active", !isOpen);
      menuToggle.setAttribute("aria-expanded", !isOpen);
      document.body.style.overflow = isOpen ? "" : "hidden";

      if (isOpen) {
        document
          .querySelectorAll(".mobile-nav-item.submenu-expanded")
          .forEach((item) => {
            item.classList.remove("submenu-expanded");
            const submenu = item.querySelector(".mobile-nav-submenu");
            if (submenu) {
              submenu.style.maxHeight = "0";
              submenu.style.opacity = "0";
            }
          });
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", () => menuToggle.click());
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) menuToggle.click();
    });

    document.addEventListener("keydown", (e) => {
      if (
        e.key === "Escape" &&
        overlay.classList.contains("mobile-menu-open")
      ) {
        menuToggle.click();
      }
    });

    document.addEventListener("click", (e) => {
      const link = e.target.closest(".mobile-nav-link");
      if (!link) return;

      const item = link.closest(".mobile-nav-item");
      const submenu = item?.querySelector(".mobile-nav-submenu");

      if (submenu) {
        e.preventDefault();
        e.stopPropagation();

        const isExpanded = item.classList.contains("submenu-expanded");

        document
          .querySelectorAll(".mobile-nav-item.submenu-expanded")
          .forEach((i) => {
            if (i !== item) {
              i.classList.remove("submenu-expanded");
              const s = i.querySelector(".mobile-nav-submenu");
              if (s) {
                s.style.maxHeight = "0";
                s.style.opacity = "0";
              }
            }
          });

        item.classList.toggle("submenu-expanded", !isExpanded);
        submenu.style.maxHeight = isExpanded
          ? "0"
          : `${submenu.scrollHeight}px`;
        submenu.style.opacity = isExpanded ? "0" : "1";
      }
    });
  },

  renderMobileMenu(tree, url) {
    const list = document.querySelector("#mobile-nav-list");
    const children = ui.menu.getChildren(tree);

    if (!list || !children.length) return;

    list.innerHTML = "";

    children.forEach((child) => {
      const submenu = ui.menu.getChildren(child);
      const hasSubmenu = submenu.length > 0;

      const li = E("li", { class: "mobile-nav-item" }, [
        E(
          "a",
          {
            class: "mobile-nav-link",
            href: hasSubmenu ? "#" : L.url(url, child.name),
          },
          [_(child.title)],
        ),
      ]);

      if (hasSubmenu) {
        const ul = E("ul", {
          class: "mobile-nav-submenu",
          style: "max-height: 0; opacity: 0;",
        });

        submenu.forEach((item) => {
          ul.appendChild(
            E("li", { class: "mobile-nav-subitem" }, [
              E(
                "a",
                {
                  class: "mobile-nav-sublink",
                  href: L.url(url, child.name, item.name),
                },
                [_(item.title)],
              ),
            ]),
          );
        });

        li.appendChild(ul);
      }

      list.appendChild(li);
    });
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

  renderMainMenu(tree, url, level = 0) {
    const ul = level
      ? E("ul", { class: "desktop-nav-list" })
      : document.querySelector("#topmenu");
    const children = ui.menu.getChildren(tree);

    if (!children.length || level > 1) return E([]);

    if (level === 0) {
      const navType = document.body?.dataset?.navType || "mega-menu";

      if (navType === "mega-menu") {
        this.initMegaMenu(children, url, ul);
      } else {
        this.initBoxedDropdown(children, url, ul);
      }
    } else {
      children.forEach((child) => {
        ul.appendChild(
          E("li", {}, [
            E("a", { href: L.url(url, child.name) }, [_(child.title)]),
          ]),
        );
      });
    }

    ul.style.display = "";
    return ul;
  },

  initMegaMenu(children, url, ul) {
    const container = document.querySelector(".desktop-menu-container");
    const overlay = document.querySelector(".desktop-menu-overlay");
    const header = document.querySelector("header");

    if (!header || !overlay) return;

    let showTimer = null;
    let hideTimer = null;

    children.forEach((child) => {
      const submenu = ui.menu.getChildren(child);
      const hasSubmenu = submenu.length > 0;

      const li = E(
        "li",
        {
          class: hasSubmenu ? "has-desktop-nav" : "",
        },
        [
          E(
            "a",
            {
              class: "menu",
              href: hasSubmenu ? "#" : L.url(url, child.name),
            },
            [_(child.title)],
          ),
        ],
      );

      ul.appendChild(li);

      if (hasSubmenu) {
        const nav = E(
          "div",
          {
            class: "desktop-nav",
          },
          [this.renderMainMenu(child, `${url}/${child.name}`, 1)],
        );

        li.appendChild(nav);

        const menuLink = li.querySelector("a");

        li.addEventListener("mouseenter", () => {
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }

          showTimer = setTimeout(() => {
            const wasActive = nav.classList.contains("active");

            document.querySelectorAll(".desktop-nav").forEach((n) => {
              if (n !== nav) n.classList.remove("active");
            });

            document.querySelectorAll("#topmenu a").forEach((a) => {
              if (a !== menuLink) a.classList.remove("menu-active");
            });

            if (wasActive) return;

            menuLink.classList.add("menu-active");
            header.classList.add("has-desktop-nav");

            requestAnimationFrame(() => {
              const navHeight = nav.scrollHeight;
              const headerHeight =
                header.querySelector(".header-content")?.offsetHeight || 56;
              const totalHeight = headerHeight + navHeight;

              if (container) {
                container.style.height = `${totalHeight}px`;
              }

              requestAnimationFrame(() => {
                nav.classList.add("active");
                overlay.classList.add("active");

                if (container) {
                  container.classList.add("active");
                }
              });
            });
          }, 100);
        });

        li.addEventListener("mouseleave", () => {
          if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
          }
        });

        menuLink.addEventListener("click", (e) => {
          e.preventDefault();
        });
      }
    });

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

  initBoxedDropdown(children, url, ul) {
    children.forEach((child) => {
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

      if (hasSubmenu) {
        const nav = E(
          "div",
          {
            class: "desktop-nav",
          },
          [this.renderMainMenu(child, `${url}/${child.name}`, 1)],
        );

        li.appendChild(nav);

        const menuLink = li.querySelector("a");
        let showTimer = null;
        let hideTimer = null;

        li.addEventListener("mouseenter", () => {
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }

          showTimer = setTimeout(() => {
            document.querySelectorAll(".desktop-nav").forEach((n) => {
              if (n !== nav) n.classList.remove("active");
            });

            document.querySelectorAll("#topmenu a").forEach((a) => {
              if (a !== menuLink) a.classList.remove("menu-active");
            });

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

        menuLink.addEventListener("click", (e) => {
          e.preventDefault();
        });
      }
    });
  },

  hideDesktopNav() {
    const navType = document.body?.dataset?.navType || "mega-menu";

    document
      .querySelectorAll(".desktop-nav")
      .forEach((nav) => nav.classList.remove("active"));
    document
      .querySelectorAll("#topmenu a")
      .forEach((a) => a.classList.remove("menu-active"));

    if (navType === "mega-menu") {
      document.querySelector("header")?.classList.remove("has-desktop-nav");

      const container = document.querySelector(".desktop-menu-container");
      if (container) {
        container.classList.remove("active");
        container.style.height = "";
      }

      document
        .querySelector(".desktop-menu-overlay")
        ?.classList.remove("active");
    }
  },

  renderModeMenu(tree) {
    const ul = document.querySelector("#modemenu");
    const children = ui.menu.getChildren(tree);
    let activeChild = null;

    children.forEach((child, index) => {
      const isActive = L.env.requestpath.length
        ? child.name === L.env.requestpath[0]
        : index === 0;

      ul.appendChild(
        E(
          "li",
          {
            class: isActive ? "active" : "",
          },
          [E("a", { href: L.url(child.name) }, [_(child.title)])],
        ),
      );

      if (isActive) activeChild = child;
    });

    if (activeChild) {
      this.renderMainMenu(activeChild, activeChild.name);
      this.renderMobileMenu(activeChild, activeChild.name);
    }

    if (ul.children.length > 1) {
      ul.style.display = "";
    }
  },
});
