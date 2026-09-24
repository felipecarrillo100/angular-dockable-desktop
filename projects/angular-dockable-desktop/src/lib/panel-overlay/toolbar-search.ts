/**
 * `<ndd-toolbar-search>`: a debounced search field for a `<ndd-panel-toolbar>` — a compact icon
 * button that expands into an input, with results in a dropdown portalled to the body so the
 * toolbar's own bounds cannot clip it.
 *
 * `search` receives an `AbortSignal` and must honour it. Without that, a slow request for an
 * earlier query can land after a fast one for a later query and overwrite it — the classic
 * stale-result race, and the reason the signal is part of the signature rather than optional.
 * Ported from vdd `VddToolbarSearch.vue`.
 */
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild, Injector } from '@angular/core';
import type { NddIcon } from '../core/icon';
import { NddIconView } from '../common/icon';
import { NddPortal } from '../common/portal';
import { Workspace } from '../workspace/workspace';

/** One row in the dropdown. */
export interface SearchResult {
  id: string;
  label: string;
  /** Secondary text, below the label. */
  description?: string;
  /** Groups results under a heading. */
  group?: string;
  icon?: NddIcon;
}

@Component({
  selector: 'ndd-toolbar-search',
  imports: [NddIconView, NddPortal],
  host: {
    class: 'ndd-panel-toolbar-search',
    '[class.ndd-panel-toolbar-search--open]': 'expanded()',
    'data-ndd-toolbar-search': '',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <button
      type="button"
      class="ndd-panel-toolbar-btn"
      [attr.title]="workspace.format(workspace.messages.search)"
      [attr.aria-label]="workspace.format(workspace.messages.search)"
      [attr.aria-expanded]="expanded()"
      data-ndd-search-toggle
      (click)="expanded() ? collapse() : expand()"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6.5" cy="6.5" r="4.5" />
        <line x1="10" y1="10" x2="14" y2="14" />
      </svg>
    </button>
    @if (expanded()) {
      <input
        #field
        class="ndd-panel-toolbar-search__input"
        type="text"
        [value]="query()"
        [attr.placeholder]="placeholder() ?? workspace.format(workspace.messages.search)"
        [attr.aria-label]="placeholder() ?? workspace.format(workspace.messages.search)"
        autocomplete="off"
        data-ndd-search-input
        (input)="onInput($event)"
        (keydown.escape)="collapse()"
      />
    }
    @if (dropdown(); as d) {
      <!-- Its z-index comes from the stylesheet, against --ndd-z-base, so zIndexBase moves it too. -->
      <div
        nddPortal
        class="ndd-panel-toolbar-search__dropdown"
        [style.position]="'fixed'"
        [style.top.px]="d.top"
        [style.left.px]="d.left"
        [style.width.px]="d.width"
        data-ndd-search-results
        (mousedown)="$event.preventDefault()"
      >
        @for (g of grouped(); track g.group) {
          @if (g.group) {
            <div class="ndd-panel-toolbar-search__group">{{ g.group }}</div>
          }
          @for (item of g.items; track item.id) {
            <button
              type="button"
              class="ndd-panel-toolbar-search__item"
              [attr.data-ndd-search-result]="item.id"
              (click)="choose(item)"
            >
              @if (item.icon; as icon) {
                <span class="ndd-panel-toolbar-search__item-icon"><ndd-icon [icon]="icon" /></span>
              }
              <span class="ndd-panel-toolbar-search__item-label">{{ item.label }}</span>
              @if (item.description) {
                <span class="ndd-panel-toolbar-search__item-desc">{{ item.description }}</span>
              }
            </button>
          }
        }
      </div>
    }
  `,
})
export class NddToolbarSearch {
  readonly placeholder = input<string | undefined>(undefined);
  /** Called on each change, debounced. Return results, or a promise of them. Honour the signal. */
  readonly search = input.required<(query: string, signal: AbortSignal) => SearchResult[] | Promise<SearchResult[]>>();
  /** Debounce in ms. */
  readonly debounce = input(300);
  /** A result was chosen. */
  readonly resultSelect = output<SearchResult>();

  protected readonly workspace = inject(Workspace) as Workspace<never>;
  private readonly root = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly expanded = signal(false);
  protected readonly query = signal('');
  private readonly results = signal<SearchResult[]>([]);
  protected readonly dropdown = signal<{ top: number; left: number; width: number } | null>(null);
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly grouped = computed(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of this.results()) {
      const key = r.group ?? '';
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map].map(([group, items]) => ({ group, items }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.reset());
  }

  private reset(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  protected expand(): void {
    this.expanded.set(true);
    afterNextRender(() => this.field()?.nativeElement.focus({ preventScroll: true }), { injector: this.injector });
  }

  protected collapse(): void {
    this.expanded.set(false);
    this.query.set('');
    this.results.set([]);
    this.dropdown.set(null);
    this.reset();
  }

  private place(): void {
    if (this.results().length === 0) return this.dropdown.set(null);
    const r = this.root.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    this.dropdown.set({ top: r.bottom + 4, left: Math.max(8, left), width });
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.reset();
    if (!this.query().trim()) {
      this.results.set([]);
      this.dropdown.set(null);
      return;
    }
    const query = this.query();
    this.timer = setTimeout(async () => {
      const own = new AbortController();
      this.controller = own;
      try {
        const found = await this.search()(query, own.signal);
        // A result that arrives after its own request was superseded is discarded here as well
        // as in the caller's fetch: an abort cannot retract a promise that has already settled.
        if (own.signal.aborted) return;
        this.results.set(found);
        this.place();
      } catch {
        // An abort, or the caller's own error. Either way there is nothing to show.
      }
    }, this.debounce());
  }

  protected choose(result: SearchResult): void {
    this.resultSelect.emit(result);
    this.collapse();
  }

  /** Collapse when focus leaves the field entirely, not when it moves inside it. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.root.contains(next)) return;
    this.collapse();
  }
}
