import { ChangeDetectionStrategy, Component, OnDestroy, effect, signal } from '@angular/core';
import { NddPanelOverlay, NddPanelToolbar, NddToolbarButton, NddToolbarSeparator, NddToolbarToggle } from 'angular-dockable-desktop';
import type { ButtonVariant, ToolbarVariant } from 'angular-dockable-desktop';

const VARIANTS: ButtonVariant[] = ['ghost', 'soft', 'outlined', 'filled'];
const BACKGROUNDS: Record<string, string> = {
  light: '#eef1f4',
  dark: '#101217',
  busy:
    'radial-gradient(circle at 15% 30%, #f6d365 0 12%, transparent 13%),' +
    'radial-gradient(circle at 70% 60%, #3a6073 0 18%, transparent 19%),' +
    'repeating-linear-gradient(45deg, #fafafa 0 14px, #1d2b3a 14px 28px, #7fb069 28px 42px)',
};
const TOKENS = ['--ndd-panel-toolbar-icon-size', '--ndd-chrome-icon-size', '--ndd-toolbar-btn-toggle-active-bg',
  '--ndd-toolbar-btn-toggle-active-color', '--ndd-toolbar-btn-toggle-active-border'];

/** Sets a token on every element that declares skin tokens, so the value wins over the skin's own. */
function setToken(name: string, value: string | null): void {
  const targets = [document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>('[data-ndd-skin]'))];
  for (const el of targets) {
    if (value === null) el.style.removeProperty(name);
    else el.style.setProperty(name, value);
  }
}

/**
 * Review page for the toolbar button spec (1.4.0, from rdd 7.5.0): every buttonVariant in every
 * state, over light, dark and busy content, with live controls for the icon size tokens. The SVG
 * icons deliberately keep width="16" height="16" attributes — the library's tokens must override them.
 */
@Component({
  selector: 'dd-toolbar-buttons-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NddPanelOverlay, NddPanelToolbar, NddToolbarButton, NddToolbarSeparator, NddToolbarToggle],
  template: `
    <div style="display: flex; flex-direction: column; height: 100%; overflow: auto">
      <div style="display: flex; flex-wrap: wrap; gap: 16px; padding: 8px 12px; align-items: center; font-size: 12px">
        <label style="display: flex; gap: 6px; align-items: center">Strip
          <select [value]="strip()" (change)="strip.set($any($event.target).value)">
            <option value="transparent">transparent</option>
            <option value="frosted">frosted</option>
            <option value="solid">solid</option>
          </select>
        </label>
        <label style="display: flex; gap: 6px; align-items: center">Content
          <select (change)="bg.set($any($event.target).value)">
            @for (k of backgroundKeys; track k) { <option [value]="k" [selected]="k === bg()">{{ k }}</option> }
          </select>
        </label>
        <label style="display: flex; gap: 6px; align-items: center">Panel icon {{ panelIcon() }}px
          <input type="range" min="14" max="24" [value]="panelIcon()" (input)="panelIcon.set(+$any($event.target).value)">
        </label>
        <label style="display: flex; gap: 6px; align-items: center">Chrome icon {{ chromeIcon() }}px
          <input type="range" min="14" max="26" [value]="chromeIcon()" (input)="chromeIcon.set(+$any($event.target).value)">
        </label>
        <label style="display: flex; gap: 6px; align-items: center">
          <input type="checkbox" [checked]="solidToggle()" (change)="solidToggle.set($any($event.target).checked)">
          Workspace toggle "on": solid (instead of tint + edge)
        </label>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; padding: 12px">
        @for (v of variants; track v) {
          <div>
            <div style="font-size: 12px; opacity: 0.7; margin-bottom: 4px">buttonVariant="{{ v }}"</div>
            <div style="position: relative; height: 120px; border-radius: 6px; overflow: hidden" [style.background]="backgrounds[bg()]">
              <ndd-panel-overlay>
                <ndd-panel-toolbar position="top" [variant]="strip()" [buttonVariant]="v">
                  <ndd-toolbar-button title="Save (action)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
                  </ndd-toolbar-button>
                  <ndd-toolbar-toggle title="Grid (toggle)" [(active)]="state[v].grid">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
                  </ndd-toolbar-toggle>
                  <ndd-toolbar-toggle title="Layers (toggle)" [(active)]="state[v].layers">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg>
                  </ndd-toolbar-toggle>
                  <ndd-toolbar-toggle title="Ruler (toggle)" [(active)]="state[v].ruler">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 13.5l2 2M16.5 10.5l2 2"/></svg>
                  </ndd-toolbar-toggle>
                  <ndd-toolbar-toggle title="Time (toggle)" [(active)]="state[v].clock">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
                  </ndd-toolbar-toggle>
                  <ndd-toolbar-separator />
                  <ndd-toolbar-toggle title="Font glyph (toggle)" [(active)]="state[v].star"><i aria-hidden="true" style="font-style: normal">★</i></ndd-toolbar-toggle>
                  <ndd-toolbar-button title="Delete (disabled)" [disabled]="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                  </ndd-toolbar-button>
                  <ndd-toolbar-toggle title="Toggle on, disabled" [active]="true" [disabled]="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
                  </ndd-toolbar-toggle>
                </ndd-panel-toolbar>
              </ndd-panel-overlay>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class ToolbarButtonsPanel implements OnDestroy {
  protected readonly variants = VARIANTS;
  protected readonly backgrounds = BACKGROUNDS;
  protected readonly backgroundKeys = Object.keys(BACKGROUNDS);
  protected readonly strip = signal<ToolbarVariant>('transparent');
  protected readonly bg = signal('busy');
  protected readonly panelIcon = signal(20);
  protected readonly chromeIcon = signal(22);
  protected readonly solidToggle = signal(false);
  /** One set of toggle states per variant row. */
  protected readonly state = Object.fromEntries(VARIANTS.map(v => [v, {
    grid: signal(true), layers: signal(false), ruler: signal(true), clock: signal(false), star: signal(true),
  }]));

  constructor() {
    effect(() => setToken('--ndd-panel-toolbar-icon-size', `${this.panelIcon()}px`));
    effect(() => setToken('--ndd-chrome-icon-size', `${this.chromeIcon()}px`));
    effect(() => {
      // Alternative workspace-toggle "on" look, for comparison: the same solid chip the panel toolbar uses.
      const on = this.solidToggle();
      setToken('--ndd-toolbar-btn-toggle-active-bg', on ? 'var(--ndd-panel-toolbar-btn-active-bg)' : null);
      setToken('--ndd-toolbar-btn-toggle-active-color', on ? 'var(--ndd-panel-toolbar-btn-active-color)' : null);
      setToken('--ndd-toolbar-btn-toggle-active-border', on ? 'transparent' : null);
    });
  }

  /** Leave the workspace as we found it when the panel closes. */
  ngOnDestroy(): void {
    for (const t of TOKENS) setToken(t, null);
  }
}
