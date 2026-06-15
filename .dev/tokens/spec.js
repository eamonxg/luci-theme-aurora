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
    mega_menu_bg: ["alpha", "surface_overlay", 0.66],
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
    progress_start: ["const", "oklch(0.4318 0.0865 166.91)"],
    progress_end: ["const", "oklch(0.621 0.145 189.632)"],
    info_surface: ["set", "info", 0.32, 0.05],
    warning_surface: ["set", "warning", 0.33, 0.06],
    success_surface: ["set", "success", 0.3, 0.05],
    danger_surface: ["set", "danger", 0.32, 0.08],
    danger_surface_hover: ["shade", "danger_surface", 0.04],
    scrim: ["const", "oklch(0 0 0 / 0.6)"],
    mega_menu_bg: ["alpha", "surface_overlay", 0.62],
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
