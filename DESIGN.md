---
name: VoxType
description: Windows-first local dictation app with calm, secure, capable setup surfaces.
colors:
  primary-cyan: "#23d6cf"
  primary-cyan-deep: "#168f8b"
  success-green: "#28d6b7"
  secure-green: "#37d7a0"
  info-blue: "#5f9dff"
  warning-amber: "#ffcf99"
  danger-red: "#ff6262"
  app-bg: "#0a1015"
  shell-bg: "#10171e"
  sidebar-bg: "#0b1218"
  panel-bg: "#121b24"
  panel-bg-deep: "#0d161d"
  field-bg: "#0d161d"
  elevated-bg: "#15191e"
  border-muted: "#4b5b6b"
  border-subtle: "#252b33"
  text-primary: "#f1f4f8"
  text-secondary: "#d7dde7"
  text-muted: "#9ca8b6"
  text-faint: "#778391"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.55rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  code:
    fontFamily: "Cascadia Code, SFMono-Regular, Consolas, monospace"
    fontSize: "0.76rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
rounded:
  none: "0"
  xs: "4px"
  sm: "5px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  page: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary-cyan-deep}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-icon:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    width: "32px"
    height: "32px"
  panel:
    backgroundColor: "{colors.panel-bg}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  input:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  chip:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "24px"
---

# Design System: VoxType

## 1. Overview

**Creative North Star: "Secure Windows Workbench"**

VoxType should feel like a compact, trustworthy Windows utility that has been tuned for everyday setup confidence. The visual system is dark, restrained, and work-focused: it uses tonal panels, precise borders, small type, and cyan status accents to make local dictation feel ready without making the user manage internals.

The release UI is beginner-friendly first. It should surface setup readiness, model state, hotkeys, profiles, and history in calm language, while dense diagnostics remain behind the Debug view in developer builds. The design must stay Windows-first and must not become a macOS clone: no traffic-light metaphors, frosted floating chrome, Apple-like settings mimicry, or generic AI SaaS polish.

**Key Characteristics:**
- Dense but readable utility layout.
- Cyan accent used for action, focus, active navigation, and local-ready status.
- Flat and layered depth through borders, tonal surfaces, and rare overlays.
- Square-to-small-radius Windows geometry, never pill-heavy except toggles and status capsules.
- Friendly setup language on release surfaces, precise diagnostics only in the Debug view.

## 2. Colors

The palette is a muted dark Windows workbench with a clear cyan signal color and small semantic accents.

### Primary
- **Workbench Cyan**: The primary accent for active navigation, focus borders, primary actions, links, and ready states. Use it sparingly so it keeps authority.
- **Deep Action Teal**: The filled primary button base and stronger action state. It should feel stable, not electric.

### Secondary
- **Secure Green**: Success and privacy-confidence states, including local readiness and healthy system indicators.
- **Signal Blue**: Informational status only, especially model or hardware metadata that is neither success nor warning.

### Tertiary
- **Installer Amber**: Update availability and non-blocking warning states.
- **Failure Red**: Destructive actions, failed setup, and serious blockers.

### Neutral
- **Workbench Black**: App and window background. It is tinted toward blue-green rather than pure black.
- **Panel Steel**: Primary panel, dropdown, modal, and field surfaces.
- **Muted Grid Line**: Borders, dividers, and separators. Borders are part of the layout language, not decoration.
- **Primary Text**: Main headings and important values.
- **Secondary Text**: Default body and control text.
- **Muted Text**: Labels, helper copy, timestamps, and metadata.

### Named Rules
**The Cyan Is Status Rule.** Cyan is for action, focus, active location, and ready state. Do not spray it across decorative shapes.

**The Tinted Dark Rule.** Never use pure black or pure white. VoxType darks should stay blue-green tinted; text should stay slightly softened.

## 3. Typography

**Display Font:** Inter with system UI fallbacks  
**Body Font:** Inter with system UI fallbacks  
**Label/Mono Font:** Cascadia Code, SFMono-Regular, Consolas, monospace

**Character:** The type system is compact, plainspoken, and operational. It should feel native to Windows utility work without copying Windows Settings outright.

### Hierarchy
- **Display** (700, 1.55rem, 1.15): Release page headings and high-level screen titles only.
- **Headline** (700, 1.1rem, 1.2): Status card headlines and major system-state labels.
- **Title** (700, 0.92rem, 1.2): Panel titles, titlebar brand, navigation labels, and modal headings.
- **Body** (400, 0.82rem, 1.45): Helper copy, setting explanations, row metadata, and empty states.
- **Label** (650, 0.72rem, 1.2): Field labels, chips, table headers, timestamps, and compact metadata.
- **Code** (400, 0.76rem, 1.45): Paths, model/runtime details, logs, OCR diagnostics, and debug-only technical values.

### Named Rules
**The Utility Scale Rule.** Keep release surfaces compact. Do not use marketing-scale type inside product panels.

**The Plain Label Rule.** Labels should name behavior, not implementation, unless the user is in the Debug view.

## 4. Elevation

VoxType is flat and layered. Depth comes from dark tonal steps, 1px borders, inset highlights, and focus rings. Shadows are reserved for dropdowns, modals, toasts, tooltips, and rare high-priority cards.

### Shadow Vocabulary
- **Inset Hairline** (`0 1px 0 rgb(255 255 255 / 0.04) inset`): Inputs, selects, and dropdown triggers.
- **Dropdown Lift** (`0 18px 46px rgb(0 0 0 / 0.34)`): Custom select menus and anchored popovers.
- **Modal Lift** (`0 24px 70px rgb(0 0 0 / 0.42)`): Modal dialogs only.
- **Status Glow** (`0 0 18px rgb(40 214 183 / 0.42)`): Small live status dots, not full cards.

### Named Rules
**The Flat First Rule.** A normal panel is not lifted. It is separated by a border and a tonal background.

**The Overlay Earns Shadow Rule.** Shadows are for things that float above the workbench: menus, modals, tooltips, toasts.

## 5. Components

### Buttons
- **Shape:** Square Windows geometry with small corners when allowed (5px); global zero-radius overrides may flatten all controls in stricter builds.
- **Primary:** Deep teal fill with cyan border, compact height (32-34px), icon plus label when the action benefits from recognition.
- **Hover / Focus:** Cyan border or 2px cyan focus halo. Use quick state transitions around 140-160ms.
- **Secondary / Ghost / Tertiary:** Dark field background, muted text, border-driven affordance. Ghost links use cyan text without a filled background.

### Chips
- **Style:** Compact bordered metadata pills with dark field background and muted text.
- **State:** Success chips turn green; active or selected chips use a cyan border and low-opacity cyan fill. Keep chip text short and scannable.

### Cards / Containers
- **Corner Style:** Small radius (6-8px) where not flattened by the app-wide zero-radius rule.
- **Background:** Tonal dark panels over a darker app shell. Avoid nested card stacks.
- **Shadow Strategy:** Flat by default; use shadows only for overlays.
- **Border:** 1px muted blue-gray border is the primary separator.
- **Internal Padding:** 12-18px depending on density; settings rows are more compact than summary panels.

### Inputs / Fields
- **Style:** Dark field background, 1px muted border, small radius, compact height, full-width when inside forms.
- **Focus:** Cyan border plus a low-opacity cyan halo.
- **Error / Disabled:** Error uses muted red background and border; disabled lowers contrast and keeps the same geometry.

### Navigation
- **Style:** Left sidebar with icon, label, and optional status slot. Active items use a cyan 2px leading edge and a restrained tonal fill.
- **Typography:** Compact label text around 0.86rem, not oversized.
- **States:** Hover uses subtle white overlay; active uses cyan icon and border. Navigation should feel like stable Windows product chrome, not a web landing page.

### Modals
- **Style:** Centered overlay with dim backdrop, dark tonal body, 1px border, and modal-only shadow.
- **Behavior:** Keep modals for editing bounded objects such as profiles and dictionary entries. Do not use a modal as the first answer to ordinary settings.

### Recording Overlay
- **Style:** Compact always-on-top work indicator. It should communicate recording or transcribing state quickly without feeling like the main app.
- **Motion:** Meter motion is functional, not decorative. It should show live input energy clearly and never distract from the target app.

## 6. Do's and Don'ts

### Do:
- **Do** keep the primary release experience beginner-friendly first, with expert diagnostics behind the Debug view.
- **Do** use cyan for action, focus, active state, and local-ready status.
- **Do** explain setup blockers in plain language before exposing paths, runtimes, or helper internals.
- **Do** keep panels flat by default, separated by borders and tonal dark surfaces.
- **Do** use lucide icons inside buttons where recognition improves scanning.
- **Do** keep the UI Windows-first and practical, especially around hotkeys, tray behavior, models, profiles, and insertion modes.

### Don't:
- **Don't** make VoxType look or feel like a macOS clone. No traffic-light chrome, translucent macOS-style panels, or Apple-like settings mimicry.
- **Don't** use generic AI SaaS styling, gamer utility aesthetics, neon cyberpunk dashboards, or sterile enterprise admin pages.
- **Don't** use decorative glassmorphism, gradient text, bokeh/orb backgrounds, or marketing hero patterns inside the product UI.
- **Don't** expose raw OCR text, runtime executable paths, VAD thresholds, prompt previews, or low-level logs in the default release surface.
- **Don't** use colored side-stripe borders greater than 1px on cards, list items, alerts, or callouts. Active navigation may use the existing 2px cyan leading edge because it marks location, not decoration.
- **Don't** add an in-app record button to the release home. VoxType recording is driven by global hotkeys and the target-app workflow.
