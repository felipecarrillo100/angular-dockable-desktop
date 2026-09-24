import type { TemplateRef, Type } from '@angular/core';

/**
 * An icon anywhere the library shows one — tabs, title bars, the taskbar, menus, toolbars,
 * the sidebar rail.
 *
 * Three forms, so no icon library is imposed (ADR 0007):
 *   - a **component** class, rendered with no inputs (an `<svg>` component, `MatIcon` wrapper…);
 *   - a **`TemplateRef`**, rendered in place — the natural choice for an inline `<svg>`;
 *   - a **string** of CSS classes, put on a `<span class="ndd-icon …">` — Bootstrap Icons
 *     (`'bi bi-map'`), Font Awesome (`'fa-solid fa-map'`) and similar class-based sets.
 */
export type NddIcon = Type<unknown> | TemplateRef<unknown> | string;
