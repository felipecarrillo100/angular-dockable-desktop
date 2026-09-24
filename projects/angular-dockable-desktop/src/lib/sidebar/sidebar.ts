/**
 * The activity bar and its resizable drawer: `<ndd-sidebar>` and `<ndd-secondary-sidebar>`.
 *
 * rdd exposed eight imperative methods through a ref — `openTab`, `closeDrawer`,
 * `getActiveTab`, `show`, `hide`, `toggle`, `setWidth`, `getWidth` — because React cannot
 * express two-way props. Every one was a getter or setter for state, so here they are four
 * `model()`s: `activeTabId`, `visible`, `stripVisible` and `width`, each bindable as
 * `[( )]`. Leave one unbound and the component keeps its own state.
 *
 * Tab content comes from an `<ng-template nddSidebarTab="id">` or the tab's `component`; the
 * drawer header can be replaced with `<ng-template nddSidebarHeader>`. Both templates are
 * typed. Ported from vdd `VddSidebar.vue`, `VddSidebarRail.vue`, `VddSidebarDrawer.vue`,
 * `VddSidebarTabScope.vue` and `VddSecondarySidebar.vue`.
 */
import {
  Component,
  Directive,
  ElementRef,
  InjectionToken,
  Injector,
  TemplateRef,
  computed,
  contentChild,
  contentChildren,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import type { Signal } from '@angular/core';
import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import { startPointerDrag } from '../core/drag-resize';
import type { SidebarContext, SidebarRailEntry, SidebarTab, SidebarTabContext } from '../core/sidebar-types';
import { isActionButton, isCustomEntry, isTabEntry, toRailArray } from '../core/sidebar-types';
import { NddIconView } from '../common/icon';


/** The strip's fixed width. The outer box animates between this and zero. */
const STRIP_PX = 56;

export type SidebarPosition = 'left' | 'right';

const SIDEBAR = new InjectionToken<SidebarContext>('ndd-sidebar');
const SIDEBAR_TAB = new InjectionToken<SidebarTabContext>('ndd-sidebar-tab');

/**
 * Control the sidebar from anywhere inside it — including a panel in the workspace, since the
 * workspace is the sidebar's own content. Resolves to the nearest sidebar, so inside an
 * `<ndd-secondary-sidebar>` it is the secondary's.
 *
 * @throws if called outside an `<ndd-sidebar>`.
 */
export function injectSidebar(): SidebarContext {
  const context = inject(SIDEBAR, { optional: true });
  if (!context) throw new Error('[angular-dockable-desktop] injectSidebar() must be called inside an <ndd-sidebar>.');
  return context;
}

/**
 * Control scoped to the tab you are inside: close the drawer, re-open this tab, or switch to
 * another, without having to know which tab you are.
 *
 * @throws if called outside a sidebar tab's content.
 */
export function injectSidebarTab(): SidebarTabContext {
  const context = inject(SIDEBAR_TAB, { optional: true });
  if (!context) throw new Error("[angular-dockable-desktop] injectSidebarTab() must be called inside a sidebar tab's content.");
  return context;
}

/** What a tab or header template receives. */
export interface NddSidebarTemplateContext {
  /** The tab, also as `let-tab`. */
  $implicit: SidebarTab;
  tab: SidebarTab;
  /** Close the drawer. */
  close: () => void;
  /** Open this tab. */
  open: () => void;
}

/**
 * Content for one sidebar tab, by id: `<ng-template nddSidebarTab="layers" let-tab let-close="close">`.
 * Wins over the tab's `component`.
 */
@Directive({ selector: 'ng-template[nddSidebarTab]' })
export class NddSidebarTabTemplate {
  /** The tab this is the content of. */
  readonly nddSidebarTab = input.required<string>();
  readonly template = inject<TemplateRef<NddSidebarTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(_dir: NddSidebarTabTemplate, _ctx: unknown): _ctx is NddSidebarTemplateContext {
    return true;
  }
}

/**
 * Replaces the library's drawer header, for whichever tab is open:
 * `<ng-template nddSidebarHeader let-tab let-close="close">`. Suppresses the default header —
 * and with it `showCloseButton` — on its own.
 */
@Directive({ selector: 'ng-template[nddSidebarHeader]' })
export class NddSidebarHeaderTemplate {
  readonly template = inject<TemplateRef<NddSidebarTemplateContext>>(TemplateRef);

  static ngTemplateContextGuard(_dir: NddSidebarHeaderTemplate, _ctx: unknown): _ctx is NddSidebarTemplateContext {
    return true;
  }
}

type Piece = 'rail' | 'drawer' | 'resizer' | 'main';
/** Left and right are the same pieces in opposite order, rendered from one list so they cannot drift. */
const LEFT: readonly Piece[] = ['rail', 'drawer', 'resizer', 'main'];
const RIGHT: readonly Piece[] = ['main', 'resizer', 'drawer', 'rail'];

/**
 * Everything the two sidebars share: inputs, models, state and template. They differ only in
 * where their side comes from, so neither forks the other's code.
 */
@Directive()
abstract class NddSidebarBase {
  readonly tabs = input.required<readonly SidebarTab[]>();
  /** Entries above the tabs, in their own area. A single entry or an array. */
  readonly headerAction = input<SidebarRailEntry | readonly SidebarRailEntry[] | null | undefined>(undefined);
  /** Entries pinned below the tabs. */
  readonly footerAction = input<SidebarRailEntry | readonly SidebarRailEntry[] | null | undefined>(undefined);
  readonly minWidth = input(150);
  readonly maxWidth = input(600);
  /** Show an "X" in the drawer header. No effect once the default header is suppressed. */
  readonly showCloseButton = input(false);
  /** Suppress the library's own drawer header for every tab. */
  readonly hideDefaultHeader = input(false);

  /** The open tab, or `null` when the drawer is closed. */
  readonly activeTabId = model<string | null>(null);
  /** Whether the whole sidebar — strip and drawer — is shown. */
  readonly visible = model(true);
  /** Whether the activity strip is shown. The drawer is unaffected. */
  readonly stripVisible = model(true);
  /** Drawer width in pixels. */
  readonly width = model(280);

  /** Which edge this sidebar is on. */
  abstract readonly side: Signal<SidebarPosition>;
  abstract readonly isSecondary: boolean;

  // Direct children only, so a primary never picks up a nested secondary's templates.
  private readonly tabTemplates = contentChildren(NddSidebarTabTemplate, { descendants: false });
  private readonly headerTemplate = contentChild(NddSidebarHeaderTemplate, { descendants: false });

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly stripPx = STRIP_PX;
  protected readonly pieces = computed(() => (this.side() === 'left' ? LEFT : RIGHT));

  protected readonly headerEntries = computed(() => toRailArray(this.headerAction() as SidebarRailEntry[] | undefined));
  protected readonly footerEntries = computed(() => toRailArray(this.footerAction() as SidebarRailEntry[] | undefined));
  /** A header or footer tab behaves exactly like a main-list tab, so they share one list. */
  private readonly allTabs = computed<SidebarTab[]>(() => [
    ...this.headerEntries().filter(isTabEntry),
    ...this.tabs(),
    ...this.footerEntries().filter(isTabEntry),
  ]);

  /** Tabs mounted at least once, for lazy mounting and `preserveState`. */
  private readonly everMounted = signal<ReadonlySet<string>>(new Set());
  /** The accumulated set, plus the open tab (a bound model can change without `openTab`), plus every eager tab. */
  private readonly mountedTabs = computed(() => {
    const result = new Set(this.everMounted());
    const active = this.activeTabId();
    if (active) result.add(active);
    for (const tab of this.allTabs()) if (tab.eagerMount) result.add(tab.id);
    return result;
  });
  /** Mounted tabs, in rail order, for the drawer. */
  protected readonly mountedList = computed(() => this.allTabs().filter(t => this.mountedTabs().has(t.id)));

  protected readonly isVisible = computed(() => this.visible() !== false);
  protected readonly isStripVisible = computed(() => this.isVisible() && this.stripVisible() !== false);
  protected readonly isOpen = computed(() => this.isVisible() && this.activeTabId() != null);
  protected readonly headerTpl = computed(() => this.headerTemplate()?.template ?? null);
  /** A header template suppresses the default header on its own, as does the input. */
  protected readonly headerOverridden = computed(() => this.hideDefaultHeader() || this.headerTpl() !== null);
  private readonly templatesById = computed(
    () => new Map(this.tabTemplates().map(t => [t.nddSidebarTab(), t.template] as const)),
  );
  /** No transition while a resize drag is in flight, or the drawer lags the pointer. Per instance. */
  protected readonly resizing = signal(false);

  /** What `injectSidebar()` returns. Built once; `position` reads the live side. */
  readonly context: SidebarContext;

  constructor() {
    // `position` and `isSecondary` are read live: inputs are not set yet when this runs.
    this.context = Object.defineProperties(
      {
        openTab: (id: string) => this.setActive(id),
        closeDrawer: () => this.setActive(null),
        activeTabId: this.activeTabId.asReadonly(),
      },
      {
        position: { get: () => this.side(), enumerable: true },
        isSecondary: { get: () => this.isSecondary, enumerable: true },
      },
    ) as SidebarContext;

    // If the open tab stops existing — its contributing panel closed, or the list changed —
    // close the drawer rather than leave it open and empty with no button left to close it.
    // Never silently fall back to a tab the user did not choose.
    effect(() => {
      const id = this.activeTabId();
      const tabs = this.allTabs();
      if (id != null && !tabs.some(t => t.id === id)) untracked(() => this.setActive(null));
    });

    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      let warnedCloseButton = false;
      effect(() => {
        if (warnedCloseButton || !this.showCloseButton() || !this.headerOverridden()) return;
        warnedCloseButton = true;
        console.warn(
          '[angular-dockable-desktop] `showCloseButton` has no effect because the default drawer header ' +
            'is suppressed (`hideDefaultHeader` is set, or an nddSidebarHeader template was given). The button ' +
            'is part of that header. Put your own close control in the nddSidebarHeader template, wired to its `close`.',
        );
      });
      let warnedMissingContent = false;
      effect(() => {
        const id = this.activeTabId();
        const tab = this.allTabs().find(t => t.id === id);
        if (warnedMissingContent || !tab || this.templatesById().has(tab.id) || tab.component) return;
        warnedMissingContent = true;
        console.warn(
          `[angular-dockable-desktop] Sidebar tab "${tab.id}" has no content: give it an ` +
            `<ng-template nddSidebarTab="${tab.id}"> or a \`component\`. The drawer will open empty.`,
        );
      });
    }
  }

  private setActive(id: string | null): void {
    const mounted = untracked(this.everMounted);
    if (id !== null) {
      if (!mounted.has(id)) this.everMounted.set(new Set(mounted).add(id));
    } else {
      // Closing: drop tabs that asked for neither eager mounting nor preserved state.
      const tabs = untracked(this.allTabs);
      const next = new Set(mounted);
      for (const kept of mounted) {
        const tab = tabs.find(t => t.id === kept);
        if (tab && !tab.eagerMount && !tab.preserveState) next.delete(kept);
      }
      if (next.size !== mounted.size) this.everMounted.set(next);
    }
    this.activeTabId.set(id);
  }

  protected toggleTab(id: string): void {
    this.setActive(this.activeTabId() === id ? null : id);
  }

  protected close(): void {
    this.setActive(null);
  }

  protected shownTabs(list: readonly SidebarTab[]): SidebarTab[] {
    return list.filter(t => !t.hidden);
  }

  protected readonly isCustomEntry = isCustomEntry;
  protected readonly isActionButton = isActionButton;
  protected asTab(entry: SidebarRailEntry): SidebarTab {
    return entry as SidebarTab;
  }

  // ── per-pane context ─────────────────────────────────────────────────────

  private readonly paneInjectors = new Map<string, Injector>();
  /**
   * Each pane gets its own injector, so `injectSidebarTab()` inside a tab's content knows which
   * tab it is without being told. Cached: a new injector would recreate the pane's content.
   */
  protected paneInjector(tabId: string): Injector {
    let injector = this.paneInjectors.get(tabId);
    if (!injector) {
      const context: SidebarTabContext = {
        tabId,
        open: () => this.setActive(tabId),
        close: () => this.setActive(null),
        openTab: id => this.setActive(id),
      };
      injector = Injector.create({ providers: [{ provide: SIDEBAR_TAB, useValue: context }], parent: this.injector });
      this.paneInjectors.set(tabId, injector);
    }
    return injector;
  }

  /** Template contexts, rebuilt only when the mounted tabs change. */
  protected readonly paneContexts = computed(
    () =>
      new Map(
        this.mountedList().map(tab => [
          tab.id,
          { $implicit: tab, tab, close: () => this.setActive(null), open: () => this.setActive(tab.id) } satisfies NddSidebarTemplateContext,
        ]),
      ),
  );

  protected tabTemplate(tabId: string): TemplateRef<NddSidebarTemplateContext> | null {
    return this.templatesById().get(tabId) ?? null;
  }

  // ── resizing ─────────────────────────────────────────────────────────────

  protected onResizeDown(event: PointerEvent): void {
    event.preventDefault();
    const el = event.currentTarget as HTMLElement;
    // The side the drawer is physically on. The layout is a flex row, so under a right-to-left
    // container `position="left"` renders on the right edge — and must grow the other way
    // (divergence N6; vdd assumed the logical side).
    const onRight = (this.side() === 'right') !== (getComputedStyle(this.host).direction === 'rtl');
    this.resizing.set(true);
    startPointerDrag({
      element: el,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      captureStart: () => this.width(),
      activeClasses: [
        { el, classes: ['ndd-active'] },
        { el: document.body, classes: ['ndd-resizing-active', 'ndd-resizing-col-active'] },
      ],
      // A right-hand drawer grows when the pointer moves left, so the delta is inverted.
      onMove: (dx, _dy, start) => {
        const next = onRight ? start - dx : start + dx;
        this.width.set(Math.max(this.minWidth(), Math.min(this.maxWidth(), next)));
      },
      onEnd: () => this.resizing.set(false),
    });
  }
}

const TEMPLATE = `
  @for (piece of pieces(); track piece) {
    @switch (piece) {
      @case ('rail') {
        <div class="ndd-sidebar-strip-outer" [style.width.px]="isStripVisible() ? stripPx : 0" data-ndd-sidebar-strip>
          <div
            class="ndd-sidebar-tabs-strip"
            [class]="'ndd-' + side()"
            [class.ndd-sidebar-tabs-strip--has-header-action]="headerEntries().length > 0"
            [class.ndd-sidebar-tabs-strip--has-footer-action]="footerEntries().length > 0"
            [style.width.px]="stripPx"
          >
            @if (headerEntries().length) {
              <div class="ndd-sidebar-header-area">
                <ng-container *ngTemplateOutlet="railArea; context: { $implicit: headerEntries() }" />
              </div>
            }
            <div class="ndd-sidebar-tabs-list">
              @for (tab of shownTabs(tabs()); track tab.id) {
                <ng-container *ngTemplateOutlet="tabButton; context: { $implicit: tab }" />
              }
            </div>
            @if (footerEntries().length) {
              <div class="ndd-sidebar-footer-area">
                <ng-container *ngTemplateOutlet="railArea; context: { $implicit: footerEntries() }" />
              </div>
            }
          </div>
        </div>
      }
      @case ('drawer') {
        <div
          class="ndd-sidebar-content-drawer"
          [class]="'ndd-' + side()"
          data-ndd-sidebar-drawer
          [style.flex-basis.px]="isOpen() ? width() : 0"
          [style.min-width.px]="isOpen() ? minWidth() : 0"
          [style.max-width.px]="isOpen() ? maxWidth() : 0"
          [style.transition]="resizing() ? 'none' : null"
        >
          @for (tab of mountedList(); track tab.id) {
            <div
              class="ndd-sidebar-drawer-pane"
              [style.display]="activeTabId() === tab.id ? 'flex' : 'none'"
              [attr.data-ndd-sidebar-pane]="tab.id"
            >
              @if (headerOverridden()) {
                @if (headerTpl(); as header) {
                  <ng-container *ngTemplateOutlet="header; context: paneContexts().get(tab.id)!; injector: paneInjector(tab.id)" />
                }
              } @else {
                <div class="ndd-sidebar-drawer-header">
                  <span class="ndd-sidebar-header-title">{{ tab.label }}</span>
                  @if (showCloseButton()) {
                    <button
                      type="button"
                      class="ndd-sidebar-drawer-close-button"
                      data-ndd-sidebar-close
                      title="Close"
                      aria-label="Close"
                      (click)="close()"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  }
                </div>
              }
              <div class="ndd-sidebar-drawer-body">
                @if (tabTemplate(tab.id); as content) {
                  <ng-container *ngTemplateOutlet="content; context: paneContexts().get(tab.id)!; injector: paneInjector(tab.id)" />
                } @else if (tab.component) {
                  <ng-container *ngComponentOutlet="tab.component; inputs: tab.inputs ?? {}; injector: paneInjector(tab.id)" />
                }
              </div>
            </div>
          }
        </div>
      }
      @case ('resizer') {
        @if (isOpen()) {
          <div
            class="ndd-resizer-bar"
            data-ndd-sidebar-resizer
            style="cursor: col-resize; width: 1px; height: 100%; flex-shrink: 0; z-index: 20"
            (pointerdown)="onResizeDown($event)"
          ></div>
        }
      }
      @default {
        <div class="ndd-sidebar-main"><ng-content /></div>
      }
    }
  }

  <ng-template #tabButton let-tab>
    <button
      type="button"
      class="ndd-sidebar-tab-btn"
      [class.ndd-active]="activeTabId() === tab.id"
      [attr.title]="tab.label"
      [attr.aria-label]="tab.label"
      [attr.aria-pressed]="activeTabId() === tab.id"
      [attr.data-ndd-sidebar-tab]="tab.id"
      (click)="toggleTab(tab.id)"
    >
      @if (tab.icon) {
        <ndd-icon [icon]="tab.icon" />
      }
    </button>
  </ng-template>

  <ng-template #railArea let-entries>
    @for (entry of entries; track $index) {
      @if (isCustomEntry(entry)) {
        <!-- a caller-rendered entry goes out exactly as given, unwrapped -->
        <ng-container *ngComponentOutlet="entry.component; inputs: entry.inputs ?? {}" />
      } @else if (isActionButton(entry)) {
        <button
          type="button"
          class="ndd-sidebar-tab-btn ndd-sidebar-header-action-btn"
          [disabled]="entry.disabled"
          [attr.title]="entry.label"
          [attr.aria-label]="entry.label"
          [attr.data-ndd-rail-action]="entry.id ?? entry.label"
          (click)="entry.onClick()"
        ><ndd-icon [icon]="entry.icon" /></button>
      } @else if (!asTab(entry).hidden) {
        <!-- a tab pinned to an area behaves exactly like one from the main list -->
        <ng-container *ngTemplateOutlet="tabButton; context: { $implicit: asTab(entry) }" />
      }
    }
  </ng-template>
`;

/**
 * The primary sidebar.
 *
 * ```html
 * <ndd-sidebar position="left" [tabs]="tabs" [(activeTabId)]="open">
 *   <ng-template nddSidebarTab="layers"><app-layers /></ng-template>
 *   <ndd-desktop />
 * </ndd-sidebar>
 * ```
 */
@Component({
  selector: 'ndd-sidebar',
  imports: [NgTemplateOutlet, NgComponentOutlet, NddIconView],
  providers: [{ provide: SIDEBAR, useFactory: () => inject(NddSidebar).context }],
  host: { class: 'ndd-sidebar-layout', '[attr.data-ndd-sidebar]': 'side()' },
  template: TEMPLATE,
})
export class NddSidebar extends NddSidebarBase {
  /** Which edge the bar and drawer sit on. */
  readonly position = input<SidebarPosition>('right');
  readonly side = this.position;
  readonly isSecondary = false;
}

/**
 * A second, independent sidebar on the opposite edge — the same code as the primary, no fork.
 *
 * Must be inside an `<ndd-sidebar>`'s content; it takes whichever side that primary is not
 * using, so it has no `position` of its own.
 */
@Component({
  selector: 'ndd-secondary-sidebar',
  imports: [NgTemplateOutlet, NgComponentOutlet, NddIconView],
  providers: [{ provide: SIDEBAR, useFactory: () => inject(NddSecondarySidebar).context }],
  host: { class: 'ndd-sidebar-layout', '[attr.data-ndd-sidebar]': 'side()' },
  template: TEMPLATE,
})
export class NddSecondarySidebar extends NddSidebarBase {
  private readonly primary = inject(SIDEBAR, { optional: true, skipSelf: true });
  readonly isSecondary = true;
  readonly side = computed<SidebarPosition>(() => (this.primary?.position === 'left' ? 'right' : 'left'));

  constructor() {
    super();
    if (!this.primary) {
      throw new Error(
        '[angular-dockable-desktop] <ndd-secondary-sidebar> must be rendered inside an <ndd-sidebar>. ' +
          'It takes the edge the primary sidebar is not using, so it needs one to be nested in.',
      );
    }
    if (this.primary.isSecondary) {
      throw new Error(
        '[angular-dockable-desktop] <ndd-secondary-sidebar> cannot be nested inside another one. ' +
          'The library supports one primary and one secondary sidebar, nothing deeper.',
      );
    }
  }
}
