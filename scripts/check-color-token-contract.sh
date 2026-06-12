#!/bin/sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TOKENS_FILE="$ROOT/.dev/src/media/_tokens.css"
MEDIA_DIR="$ROOT/.dev/src/media"

expected="$(mktemp)"
actual="$(mktemp)"
missing="$(mktemp)"
extra="$(mktemp)"
trap 'rm -f "$expected" "$actual" "$missing" "$extra"' EXIT HUP INT TERM

cat >"$expected" <<'EOF'
brand
brand-emphasis
brand-faint
brand-hover
brand-soft
button-muted-bg
button-muted-border
button-muted-content
button-muted-hover-bg
button-secondary-bg
button-secondary-border
button-secondary-content
button-secondary-hover-bg
canvas
card-action-bg
content
content-muted
content-subtle
danger
danger-border
danger-content
danger-surface
focus-ring
glass-raised
glass-surface
header-bg
header-glass-bg
header-interactive-bg
ifacebox-header-bg
info
info-border
info-content
info-surface
input-bg
input-checked-content
interface-badge-bg
link
neutral-status-border
neutral-status-content
neutral-status-surface
on-brand
progress-end
progress-start
progress-track-bg
scrim
segmented-control-bg
success
success-border
success-content
success-surface
surface
surface-muted
surface-raised
surface-subtle
table-header-bg
table-row-alternate-bg
table-row-hover-bg
terminal-bg
terminal-content
tooltip-bg
warning
warning-border
warning-content
warning-surface
border-faint
border-strong
border-subtle
EOF

sort -u "$expected" -o "$expected"

rg -o -- '--color-[a-z0-9-]+:' "$TOKENS_FILE" \
  | sed 's/^--color-//; s/:$//' \
  | sort -u >"$actual"

comm -23 "$expected" "$actual" >"$missing"
comm -13 "$expected" "$actual" >"$extra"

failed=0

if [ -s "$missing" ]; then
  printf '%s\n' "Missing final --color-* mappings:" >&2
  sed 's/^/  /' "$missing" >&2
  failed=1
fi

if [ -s "$extra" ]; then
  printf '%s\n' "Unexpected --color-* mappings:" >&2
  sed 's/^/  /' "$extra" >&2
  failed=1
fi

mapping_count="$(wc -l <"$actual" | tr -d ' ')"
if [ "$mapping_count" -ne 67 ]; then
  printf 'Expected 67 distinct --color-* mappings, found %s\n' "$mapping_count" >&2
  failed=1
fi

legacy_names='background|page-bg|panel-bg|foreground|primary|primary-foreground|info-foreground|warning-foreground|success-foreground|error-foreground|error|destructive|secondary|secondary-foreground|muted|muted-foreground|default|default-foreground|accent|accent-foreground|border|ink-faint|ink-soft|ink-strong|overlay-base|glass-soft|glass|glass-panel|glass-header|header-interactive|terminal-foreground|progress-bar-start|progress-bar-end|input-checked|label-surface|login-aurora-[1-4]'

legacy_declarations="$(
  rg -n -- "--(${legacy_names}):|--color-(${legacy_names}):" "$TOKENS_FILE" || true
)"
if [ -n "$legacy_declarations" ]; then
  printf '%s\n%s\n' "Legacy token declarations remain:" "$legacy_declarations" >&2
  failed=1
fi

numeric_color_opacity="$(
  rg -n \
    '(^|[[:space:]])([a-z0-9-]+:)*(bg|text|border|ring|fill|stroke|from|via|to|placeholder|scrollbar-thumb|scrollbar-track)-[^[:space:];]+/[0-9]+' \
    "$MEDIA_DIR" || true
)"
if [ -n "$numeric_color_opacity" ]; then
  printf '%s\n%s\n' "Numeric Tailwind color opacity modifiers remain:" "$numeric_color_opacity" >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

printf 'Color token contract passed: 67 mappings, no legacy declarations, no numeric color opacity modifiers.\n'
