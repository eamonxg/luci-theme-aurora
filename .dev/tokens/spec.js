// Operators: ['mix',a,b,p] ['shade',a,dl] ['set',a,L,C]
// ['alpha',a,p] ['const',str]
export const DERIVATIONS = {
  light: {
    text_muted: ["mix", "text", "bg", 0.62],
    text_subtle: ["mix", "text", "bg", 0.48],
    surface_sunken: ["shade", "bg", -0.010],
    surface_overlay: ["shade", "bg", 0.016],
    hairline: ["alpha", "text", 0.08],
    hover_faint: ["shade", "bg", -0.04],
    brand_hover: ["shade", "brand", -0.06],
    brand_subtle: ["mix", "brand", "bg", 0.12],
    brand_subtle_hover: ["shade", "brand_subtle", -0.04],
    focus_ring: ["alpha", "brand", 0.6],
    progress_start: ["mix", "brand", "surface_sunken", 0.65],
    progress_end: ["const", "var:brand"],
    info_surface: ["set", "info", 0.94, 0.05],
    warning_surface: ["set", "warning", 0.95, 0.05],
    success_surface: ["set", "success", 0.94, 0.05],
    danger_surface: ["set", "danger", 0.94, 0.05],
    danger_surface_hover: ["shade", "danger_surface", -0.04],
    scrim: ["const", "oklch(0 0 0 / 0.6)"],
    // Fully opaque: a clean solid panel (Apple's #fafafc). Any translucency let
    // the dimmed curtain bleed through, greying the panel off the header tone
    // and leaking faint blurred page content into the empty columns. The header
    // lifts to this same colour when the menu opens (see _layout.css) so bar and
    // panel read as one continuous surface.
    mega_menu_bg: ["alpha", "surface_overlay", 1],
    // Mega-menu curtain: a real dimming layer. A near-page-light grey (the
    // earlier #e8e8ed attempt) only blurred without darkening, so the mask read
    // as absent. Black at a modest alpha actually dims the page; the now-opaque
    // panel + its shadow give a clean edge, so this no longer bands the way the
    // old translucent panel over a heavy scrim did. Lighter than the 0.6 modal
    // scrim — it's a menu backdrop, not a dialog.
    mega_menu_scrim: ["const", "oklch(0 0 0 / 0.32)"],
  },
  dark: {
    text_muted: ["mix", "text", "bg", 0.62],
    text_subtle: ["mix", "text", "bg", 0.42],
    surface_sunken: ["shade", "surface", -0.045],
    surface_overlay: ["shade", "surface", 0.02],
    hairline: ["alpha", "text", 0.1],
    hover_faint: ["alpha", "text", 0.05],
    brand_hover: ["shade", "brand", -0.05],
    brand_subtle: ["mix", "brand", "bg", 0.16],
    brand_subtle_hover: ["shade", "brand_subtle", 0.04],
    focus_ring: ["alpha", "brand", 0.6],
    // Derived from brand like light — not hardcoded — so the bar tracks the
    // active brand colour instead of a frozen teal.
    progress_start: ["mix", "brand", "surface_sunken", 0.65],
    progress_end: ["const", "var:brand"],
    info_surface: ["set", "info", 0.32, 0.05],
    warning_surface: ["set", "warning", 0.33, 0.06],
    success_surface: ["set", "success", 0.3, 0.05],
    danger_surface: ["set", "danger", 0.32, 0.08],
    danger_surface_hover: ["shade", "danger_surface", 0.04],
    scrim: ["const", "oklch(0 0 0 / 0.6)"],
    // Deeper than surface_overlay (23%): surface_sunken (16.5%) tracks Apple's
    // opened-panel #161617 (~18.5%). Fully opaque — a clean solid panel with no
    // curtain bleed; the header lifts to this colour on open (see _layout.css)
    // so bar and panel are one continuous surface.
    mega_menu_bg: ["alpha", "surface_sunken", 1],
    // Dark curtain stays a near-black dim (Apple's rgba(0,0,0,.4)); the dark
    // panel and dark page already share a tone, so this only needs to deepen.
    mega_menu_scrim: ["const", "oklch(0 0 0 / 0.5)"],
  },
};

// Fixed mode-specific literals, emitted verbatim rather than derived.
export const FIXED = {
  light: {
    app_shadow_sm:
      "0 1px 3px oklch(0 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.04)",
    app_shadow_md:
      "0 4px 16px oklch(0 0 0 / 0.08), 0 1px 3px oklch(0 0 0 / 0.04)",
    app_shadow_lg: "0 12px 32px oklch(0 0 0 / 0.12)",
  },
  dark: {
    app_shadow_sm: "0 4px 12px oklch(0 0 0 / 0.3)",
    app_shadow_md: "0 10px 28px oklch(0 0 0 / 0.42)",
    app_shadow_lg: "0 20px 48px oklch(0 0 0 / 0.55)",
  },
};
