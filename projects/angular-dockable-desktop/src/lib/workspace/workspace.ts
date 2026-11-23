/**
 * The workspace: signal state plus every action that mutates it.
 *
 * Created outside the component tree and live from that moment, so an application can drive
 * it from a service, a guard or a plain module — no queueing, no "connected" state (vdd ADR
 * 0004, ADR 0001 here). `provideDockableDesktop()` hands it to DI; `inject(Workspace)` reads it.
 *
 * Ported from vdd `src/core/workspace.ts`. The actions, their order of effects and their
 * defect fixes (D1–D4, self-drop) are vdd's; what changed is the reactive substrate:
 *   - one immutable `WritableSignal<WorkspaceState>`, replaced on every change;
 *   - **every read inside an action is `untracked`**, so calling an action from an `effect()`
 *     can never make that effect depend on the whole store and loop;
 *   - in development, published state is deep-frozen (stopping at application `props`), so
 *     "state is read-only from the outside" holds without a proxy;
 *   - `subscribe()` made in an injection context is disposed with it (`DestroyRef`).
 */
import { DestroyRef, computed, inject, signal, untracked } from '@angular/core';
import type { InputSignalWithTransform, ModelSignal, Signal, Type, WritableSignal } from '@angular/core';
import type {
  DirtyStateOptions,
  DropPosition,
  PanelDrop,
  FloatAnchor,
  FloatingWindow,
  HostedPanelPlacement,
  Label,
  LayoutNode,
  MessageDescriptor,
  MessageFormatter,
  PanelInfo,
  PanelOwner,
  SerializedLayout,
  SplitDirection,
} from '../core/types';
import type { LayoutLeafNode, PopOutResult } from '../core/types';
import {
  addPanelToLeaf,
  deriveActivePanelId,
  dockToEdge,
  emptyRoot,
  findFirstLeafId,
  findLeafForPanel,
  insertPanelInLeaf,
  isLoneOccupant,
  isVisibleActiveTarget,
  leafExists,
  removeLeafFromTree,
  removePanelFromTree,
  selectPanelInTree,
  splitLeafInTree,
  updateSizesAtPath,
} from '../core/layout-tree';
import type { ActiveTargetScope } from '../core/layout-tree';
import { findLeaf, groupOf, insertPanelAmongMates, placesBeside, resolveActivePanelId, returnBeside } from '../core/layout-tree';
import type { PlaceBeside } from '../core/layout-tree';
import { DEFAULT_FLOAT_RECT, LAYOUT_VERSION, parseInitialState } from '../core/serialize';
import { isSerializable } from '../core/serializable';
import { PanelRegistry } from '../core/registry';
import type { PanelDefaultOptions, PanelLoader } from '../core/registry';
import { HOSTED_COMPONENT, optionsFor } from '../core/panel-options';
import type { NddIcon } from '../core/icon';
import { EventBus } from '../core/event-bus';
import type { BuiltInEvents } from '../core/event-bus';
import { menuInitialFocus, menuPosition } from '../core/context-menu';
import type { ContextMenuItem, ContextMenuRequest, ShowContextMenuOptions } from '../core/context-menu';
import { defaultMessages, formatLabel } from '../core/messages';
import { createToolbarState } from '../core/toolbar-state';
import type { ToolbarState } from '../core/toolbar-state';
import { createOverlays } from '../core/overlays';
import type { Overlays } from '../core/overlays';
import { activeContributionSignal, createContributions } from '../core/contributions';
import type { Contributions, PanelContribution } from '../core/contributions';
import { docOf, isNode } from '../core/dom-context';

/** One entry in the panel catalogue: an eager `component`, or a lazy `loadComponent`. */
export type PanelDefinition =
  | { component: Type<unknown>; loadComponent?: never; defaultOptions?: PanelDefaultOptions }
  | { loadComponent: PanelLoader; component?: never; defaultOptions?: PanelDefaultOptions };

/** Configuration for {@link createWorkspace} / `provideDockableDesktop()`. */
export interface WorkspaceConfig {
  /** The panel catalogue: keys used by `openPanel` and in saved layouts. */
  panels?: Record<string, PanelDefinition>;
  /** A layout from a previous `saveLayout()`. `null`/omitted starts from an empty workspace. */
  initialState?: string | null;
  /** Reading direction. `'rtl'` mirrors drop zones, tab order and corner anchors. @default 'ltr' */
  dir?: 'ltr' | 'rtl';
  /** Resolves the library's own message descriptors. The whole i18n surface. */
  formatMessage?: MessageFormatter;
  /** Override any subset of the built-in UI strings. */
  messages?: Partial<Record<keyof typeof defaultMessages, MessageDescriptor>>;
  /** Fraction taken by a panel dropped on a leaf's edge. Clamped to 0.1–0.9. @default 0.5 */
  defaultSplitRatio?: number;
  /** Fraction taken by a panel dropped on a workspace edge. Clamped to 0.1–0.9. @default 0.2 */
  defaultEdgeSplitRatio?: number;
  /** Base z-index for floating windows and all library chrome, mirrored as `--ndd-z-base`. @default 1000 */
  zIndexBase?: number;
  /**
   * Your own classes, added to the library's chrome — for attaching a styling framework's
   * utilities to elements inside the library's markup. The library's `ndd-` classes stay.
   */
  classes?: HostClasses;
  /**
   * Veto where users can move panels (1.8.0). Called for each place a dragged panel could go, and
   * for the built-in "Float" and "Maximize" menu items: return `false` and that target isn't offered
   * and the move doesn't happen. It runs after the kind's own `canFloat` / `canDock`, and only for
   * what the user does: the app's own calls always work. Keep it fast and pure; it runs while the
   * pointer moves.
   */
  canDrop?: (drop: PanelDrop) => boolean;
  /**
   * Lets panels move into their own browser window, for a second monitor (1.12.0, rdd 7.12.0): a
   * panel type opts in with `defaultOptions.canPopOut`, and the user opens it with "Open in new
   * window" or the app with `workspace.popOutPanel(id)`. Set once, here; it is not kept on
   * `workspace.config`. With `false`, nothing of it runs: no menu item, and `popOutPanel` returns
   * `{ ok: false, reason: 'disabled' }`. @default false
   *
   * ```ts
   * provideDockableDesktop({
   *   popOut: true,
   *   panels: { chart: { component: ChartPanel, defaultOptions: { canPopOut: true } } },
   * });
   * ```
   */
  popOut?: boolean;
}

/**
 * @internal What the pop-out windows registry lends the workspace (1.12.0): the windows
 * themselves live outside the store, because `window.open` must run inside the user's click.
 * Bound with {@link Workspace.bindPopOutWindows}.
 */
export interface PopOutWindowsBinding {
  /** `popOutPanel(id)`, once the workspace has checked `popOut` itself. */
  popOut(id: string): PopOutResult;
  /** `returnPanel(id)`. */
  returnPanel(id: string): { ok: boolean };
  /** Brings a panel's window forward, best effort; `false` when it has none. */
  focusWindow(id: string): boolean;
}

/** The layout part of the state, as plain values: what a popped-out panel's return place is worked out on. */
type Snapshot = Pick<WorkspaceState, 'gridRoot' | 'floating' | 'minimized' | 'panels' | 'activePanelId'>;

/** Consumer classes added to the library's chrome. Every field is optional. */
export interface HostClasses {
  /** The modal's window box. */
  modal?: string;
  /** The modal's scrolling body. */
  modalBody?: string;
  /** A side panel's window box. */
  sidePanel?: string;
  /** A side panel's scrolling body. */
  sidePanelBody?: string;
  /** A floating window's outer box. */
  window?: string;
  /** A floating window's body, which holds the panel. */
  windowBody?: string;
}

/** Options for {@link Workspace.openPanel}. */
export interface OpenPanelOptions<I extends object = Record<string, unknown>> {
  /** Override the tab/window title. */
  title?: Label;
  /** Where it goes. @default the registry's `initialTarget`, else `'docked'` */
  initialTarget?: 'floating' | 'docked' | 'tabbed';
  /** Corner to pin to, for a floating panel. */
  anchor?: FloatAnchor | null;
  /** Make it the active panel. @default true */
  focus?: boolean;
  /**
   * The panel component's inputs, applied with `ComponentRef.setInput`. Saved in the layout
   * under `props` (the family's shared format), when they are serialisable.
   */
  inputs?: I;
  /** If another open panel of the same `component` has this key, focus that one instead. */
  dedupeKey?: string;
  /**
   * Dock the new panel beside an open, docked panel: in that panel's group (`position: 'center'`,
   * as a tab) or in a new group split off on one side of it. `size` is the new group's share of
   * that split, from 0.1 to 0.9 (the workspace's split ratio when omitted). Wins over
   * `initialTarget`. If `panel` is not docked (not open, floating or minimised), the new panel is
   * placed as usual and, in development, a warning says why. Applies only to a newly opened
   * panel. (1.7.0)
   */
  dockTo?: { panel: string; position: DropPosition; size?: number };
}

/** The live workspace state. */
export interface WorkspaceState {
  gridRoot: LayoutNode;
  floating: FloatingWindow[];
  minimized: { id: string; title: Label; component: string }[];
  panels: Record<string, PanelInfo>;
  /** The panel the user is looking at. Always visible, never minimised. */
  activePanelId: string | null;
  /** The panel being dragged, or `null`. */
  draggedPanelId: string | null;
  dir: 'ltr' | 'rtl';
  isRtl: boolean;
  splitRatio: number;
  edgeSplitRatio: number;
}

interface RequestCloseOptions {
  force?: boolean;
  onConfirm?: (opts?: DirtyStateOptions) => Promise<boolean>;
}

const clampRatio = (n: number | undefined, fallback: number): number =>
  Math.min(0.9, Math.max(0.1, n ?? fallback));

const DEFAULT_RECT = DEFAULT_FLOAT_RECT;

/** Whether any group of the tree holds a panel. */
const hasDockedPanel = (n: LayoutNode): boolean => (n.type === 'leaf' ? n.panels.length > 0 : n.children.some(hasDockedPanel));
/** The tree's groups, in document order. */
const leavesOf = (n: LayoutNode): LayoutLeafNode[] => (n.type === 'leaf' ? [n] : n.children.flatMap(leavesOf));

// Dev-only code is guarded inline with `typeof ngDevMode === 'undefined' || ngDevMode`: the CLI
// defines `ngDevMode` as false in production, so the guard folds to `false` and the branch — message
// strings included — is dropped. Behind a helper function it would not fold (found in M12).

/**
 * Deep-freeze library-owned state in development. Stops at `props`: those are the
 * application's own objects, and freezing them would reach into data the library does not own.
 */
function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  // A PanelInfo record: everything but its `props` (a panel id may itself be "props", so the
  // test is the record's shape, not the key).
  const isPanel = 'component' in value && 'serializable' in value;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!(isPanel && k === 'props')) freeze(v);
  return Object.freeze(value);
}

/**
 * A workspace instance: signal state, actions, the panel registry, and the shared services the
 * library's components render (context menu, toolbar state, contributions, overlays).
 *
 * Create with {@link createWorkspace}, or let `provideDockableDesktop(config)` create one.
 */
export class Workspace<TEvents extends Record<string, unknown> = Record<string, unknown>> {
  /** The panel catalogue. */
  readonly registry = new PanelRegistry();
  /** Toolbar selection state for uncontrolled items. Reachable anywhere, even from a service. */
  readonly toolbar: ToolbarState = createToolbarState();
  /** Toolbar items and sidebar sections panels publish while they are active. */
  readonly contributions: Contributions = createContributions();
  /** Side panels and the modal stack. */
  readonly overlays: Overlays = createOverlays();
  /** Your own classes for the library's chrome, with every field present. */
  readonly classes: Required<HostClasses>;
  /** The merged message table. */
  readonly messages: Record<keyof typeof defaultMessages, MessageDescriptor>;
  readonly config: Readonly<WorkspaceConfig & { zIndexBase: number }>;

  private readonly bus = new EventBus<TEvents>();
  private readonly closeGuards = new Map<string, () => boolean | Promise<boolean>>();
  private readonly stateProviders = new Map<string, () => unknown>();
  private readonly panelMenus = new Map<string, () => ContextMenuItem[]>();
  /** Hosted panels' close handlers, by panel id: the widget's overlay registers them (rdd 7.11.0). */
  private readonly hostedCloseHandlers = new Map<string, () => void>();
  /** ...and what to call just before a layout load drops one (a load never keeps a hosted panel). */
  private readonly hostedDropHandlers = new Map<string, () => void>();
  /** See {@link Workspace.onStateChange}. */
  private readonly stateListeners = new Set<(next: Readonly<WorkspaceState>, previous: Readonly<WorkspaceState>) => void>();
  /** Bumped when a panel registers or withdraws menu items, so a `computed` asking "does this
   *  panel contribute anything?" has something to track. The items themselves are pulled. */
  private readonly panelMenuVersion = signal(0);
  private readonly menu = signal<ContextMenuRequest | null>(null);
  private readonly _state: WritableSignal<WorkspaceState>;
  private readonly zIndexBase: number;
  private maxZ: number;
  /** @internal Whether the workspace was created with `popOut: true` (1.12.0); not on `config`. */
  readonly popOutEnabled: boolean;
  /**
   * Where each popped-out panel was beside its neighbours in the grid, and its group-mates, for a
   * panel alone in its group: that group goes when the panel leaves, so `lastLeafId` alone can't
   * bring it back. Runtime only (1.12.0).
   */
  private readonly popOutOrigins = new Map<string, { places: PlaceBeside[]; mates: string[]; seq: number }>();
  /** Counts pop-outs, so returns can be replayed last out first. */
  private popOutSeq = 0;
  /** Numbers the groups a return creates. */
  private popOutLeafSeq = 0;
  private readonly popOutEndListeners = new Set<(id: string) => void>();
  private popOutWindows: PopOutWindowsBinding | null = null;
  private warnedPopOutDisabled = false;
  /** False while `activatePanel` runs `focusPanel`: the panel becomes the active one, no window comes forward. */
  private focusOwnWindow = true;

  /** The whole state, read-only. */
  readonly state: Signal<Readonly<WorkspaceState>>;
  readonly gridRoot: Signal<LayoutNode>;
  readonly floating: Signal<FloatingWindow[]>;
  readonly minimized: Signal<WorkspaceState['minimized']>;
  readonly panels: Signal<Record<string, PanelInfo>>;
  readonly activePanelId: Signal<string | null>;
  readonly draggedPanelId: Signal<string | null>;
  readonly dir: Signal<'ltr' | 'rtl'>;
  readonly isRtl: Signal<boolean>;
  /** The pending context-menu request, or `null`. Rendered by `<ndd-context-menu>`. */
  readonly contextMenu: Signal<ContextMenuRequest | null>;
  /** What the active panel has published, or `null`. */
  readonly activeContribution: Signal<PanelContribution | null>;

  constructor(config: WorkspaceConfig = {}) {
    for (const [key, def] of Object.entries(config.panels ?? {})) {
      if (def.loadComponent) this.registry.registerLazy(key, def.loadComponent, def.defaultOptions);
      else this.registry.register(key, def.component!, def.defaultOptions);
    }
    this.messages = { ...defaultMessages, ...(config.messages ?? {}) } as Record<keyof typeof defaultMessages, MessageDescriptor>;
    this.zIndexBase = config.zIndexBase ?? 1000;
    this.maxZ = this.zIndexBase;
    // `popOut` is set once, at creation, and not kept on `config` (rdd 7.12.0 S2.1).
    const { popOut, ...rest } = config;
    this.config = { ...rest, zIndexBase: this.zIndexBase };
    this.popOutEnabled = popOut === true;
    if (!this.popOutEnabled && (typeof ngDevMode === 'undefined' || ngDevMode)) {
      const types = Object.entries(config.panels ?? {}).filter(([, def]) => def.defaultOptions?.canPopOut).map(([key]) => key);
      if (types.length > 0) {
        this.warn(
          `Panel type${types.length > 1 ? 's' : ''} ${types.map(t => `"${t}"`).join(', ')} set canPopOut, but ` +
            `this workspace was created without popOut, so no panel can open in its own window. Pass ` +
            `provideDockableDesktop({ popOut: true }) to enable it.`,
        );
      }
    }
    this.classes = {
      modal: config.classes?.modal ?? '',
      modalBody: config.classes?.modalBody ?? '',
      sidePanel: config.classes?.sidePanel ?? '',
      sidePanelBody: config.classes?.sidePanelBody ?? '',
      window: config.classes?.window ?? '',
      windowBody: config.classes?.windowBody ?? '',
    };

    const initial = this.withTitles(parseInitialState(config.initialState, (typeof ngDevMode === 'undefined' || ngDevMode) ? m => this.warn(m) : undefined));
    this._state = signal<WorkspaceState>(
      this.publishable({
        gridRoot: initial.gridRoot,
        floating: initial.floating,
        minimized: initial.minimized,
        panels: initial.panels,
        activePanelId: initial.activePanelId,
        draggedPanelId: null,
        dir: config.dir ?? 'ltr',
        isRtl: config.dir === 'rtl',
        splitRatio: clampRatio(config.defaultSplitRatio, 0.5),
        edgeSplitRatio: clampRatio(config.defaultEdgeSplitRatio, 0.2),
      }),
    );
    // Keep maxZ above anything a restored layout already used.
    for (const w of initial.floating) this.maxZ = Math.max(this.maxZ, w.z);

    this.state = this._state.asReadonly();
    this.gridRoot = computed(() => this._state().gridRoot);
    this.floating = computed(() => this._state().floating);
    this.minimized = computed(() => this._state().minimized);
    this.panels = computed(() => this._state().panels);
    this.activePanelId = computed(() => this._state().activePanelId);
    this.draggedPanelId = computed(() => this._state().draggedPanelId);
    this.dir = computed(() => this._state().dir);
    this.isRtl = computed(() => this._state().isRtl);
    this.contextMenu = this.menu.asReadonly();
    // A hosted panel (a widget out of its panel, rdd 7.11) brings its owner's contribution: the
    // widget's content publishes nothing of its own (its panel context is the owner's).
    this.activeContribution = activeContributionSignal(this.contributions, () => this._state().activePanelId, id => this.panels()[id]?.owner?.panelId);
  }

  // ── state plumbing ─────────────────────────────────────────────────────────

  /** The current state, read without tracking — actions must never subscribe their caller. */
  private get s(): WorkspaceState {
    return untracked(this._state);
  }

  private set(patch: Partial<WorkspaceState>): void {
    const previous = this.s;
    this._state.set(this.publishable({ ...this.s, ...patch }));
    for (const listener of this.stateListeners) listener(this.s, previous);
  }

  /**
   * @internal Called synchronously after every state write, before anything renders: a widget's
   * overlay sees the user move its hosted panel while the element is still where it was, and
   * calls the widget's `onWillMove` (rdd 7.11.0, M5). A signal effect would run too late. One
   * action may write several times; a listener sees every step. Returns the unregister function.
   */
  onStateChange(listener: (next: Readonly<WorkspaceState>, previous: Readonly<WorkspaceState>) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private publishable(state: WorkspaceState): WorkspaceState {
    return (typeof ngDevMode === 'undefined' || ngDevMode) ? freeze(state) : state;
  }

  private warn(message: string): void {
    if (typeof ngDevMode === 'undefined' || ngDevMode) console.warn(`[angular-dockable-desktop] ${message}`);
  }

  private scope(): ActiveTargetScope {
    const s = this.s;
    return { gridRoot: s.gridRoot, floating: s.floating, panels: s.panels };
  }

  /**
   * The single place `activePanelId` is decided. **Every** action that changes where a panel
   * lives ends by calling this. rdd resolved it action by action and accumulated five places
   * that forgot to (vdd D2); funnelling it here makes that bug unrepeatable.
   *
   * @param prefer a panel that should become active if it is visible — the one just opened,
   *               restored or docked. Omit to keep the current one if still valid.
   */
  private resolveActive(prefer?: string | null): void {
    const previous = this.s.activePanelId;
    let next: string | null;
    if (prefer && isVisibleActiveTarget(prefer, this.scope())) next = prefer;
    else if (previous && isVisibleActiveTarget(previous, this.scope())) next = previous;
    else next = deriveActivePanelId(this.scope());
    if (next !== previous) {
      this.set({ activePanelId: next });
      this.bus.emit('panel:activated', { id: next, previous });
    }
  }

  private layoutChanged(): void {
    this.bus.emit('layout:changed', {});
  }

  /** An open panel's options (its kind's, or a hosted panel's own), or `{}`. */
  private optionsOf(id: string): PanelDefaultOptions {
    return optionsFor(this.registry, this.s.panels[id]) ?? {};
  }

  /** Free a spot for a new floating window, cascading away from anything at the same place. */
  private cascade(fav: { x: number | string; y: number | string; width: number | string; height: number | string }): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const num = (v: number | string, fallback: number) => {
      const n = typeof v === 'string' ? Number.parseFloat(v) : v;
      return Number.isNaN(n) ? fallback : n;
    };
    let x = num(fav.x, DEFAULT_RECT.x);
    let y = num(fav.y, DEFAULT_RECT.y);
    const width = num(fav.width, DEFAULT_RECT.width);
    const height = num(fav.height, DEFAULT_RECT.height);
    const overlaps = (px: number, py: number) =>
      this.s.floating.some(w => {
        if (w.maximized) return false;
        // A panel in its own window (1.12.0) keeps an entry here that nothing draws: not in the way.
        if (this.s.panels[w.id]?.poppedOut) return false;
        const wx = typeof w.x === 'string' ? Number.parseFloat(w.x) : w.x;
        const wy = typeof w.y === 'string' ? Number.parseFloat(w.y) : w.y;
        return Math.abs(wx - px) < 20 && Math.abs(wy - py) < 20;
      });
    let attempts = 0;
    while (overlaps(x, y) && attempts < 10) {
      x += 30;
      y += 30;
      attempts++;
    }
    // A workspace can be driven with no window at all (a service, SSR, a test), so guard both.
    const viewW = Math.max(100, (typeof window !== 'undefined' && window.innerWidth) || 1024);
    const viewH = Math.max(100, (typeof window !== 'undefined' && window.innerHeight) || 768);
    if (x + width > viewW || y + height > viewH) {
      x = 100 + (attempts % 5) * 30;
      y = 100 + (attempts % 5) * 30;
    }
    return {
      x: Math.max(0, Math.min(x, viewW - 100)), // keep the title bar reachable
      y: Math.max(0, Math.min(y, viewH - 40)),
      width,
      height,
    };
  }

  private addFloating(id: string, rect: ReturnType<Workspace['cascade']>, anchor: FloatAnchor | null): void {
    this.maxZ += 1;
    this.set({ floating: [...this.s.floating, { ...rect, id, z: this.maxZ, anchor }] });
  }

  /** Detach a panel from wherever it currently is, without deciding where it goes next. */
  private detach(id: string): void {
    const before = this.s.gridRoot;
    // `null` means the tree emptied. When the root was a leaf, keep *that* leaf — emptied — so
    // its id, `keepOnEmpty` and `canClose` survive (vdd SD6).
    this.set({
      gridRoot:
        removePanelFromTree(before, id) ??
        (before.type === 'leaf' ? { ...before, panels: [], activePanelId: null } : emptyRoot()),
      floating: this.s.floating.filter(w => w.id !== id),
      minimized: this.s.minimized.filter(m => m.id !== id),
    });
  }

  private setPanel(id: string, info: PanelInfo): void {
    this.set({ panels: { ...this.s.panels, [id]: info } });
  }

  /**
   * Would this placement destroy its own target? Detaching a lone panel deletes its leaf, so a
   * drop onto that same leaf asks for a target that will not exist — the result the user asked
   * for is the layout they already have. A target that is *already* gone is refused with a
   * warning rather than leaving the panel in no group.
   */
  private placementIsPointless(panelId: string, targetLeafId: string, action: string): boolean {
    const root = this.s.gridRoot;
    if (isLoneOccupant(root, targetLeafId, panelId)) return true;
    if (!leafExists(root, targetLeafId)) {
      if (typeof ngDevMode === 'undefined' || ngDevMode)
        this.warn(
        `${action}("${panelId}", "${targetLeafId}") was ignored: no group with that id is in ` +
          `the layout. Emptying a group removes it, so an id kept across a layout change can ` +
          `name a group that no longer exists.`,
      );
      return true;
    }
    return false;
  }

  // ── actions ────────────────────────────────────────────────────────────────

  openPanel<I extends object = Record<string, unknown>>(id: string, component: string, options?: OpenPanelOptions<I>): void {
    if (!this.registry.has(component)) {
      if (typeof ngDevMode === 'undefined' || ngDevMode)
        this.warn(
        `Panel "${id}" references component key "${component}", which is not registered. ` +
          `Add it to provideDockableDesktop({ panels: { "${component}": { component: YourComponent } } }).`,
      );
    }

    // Dedupe redirect first: the caller's id and inputs are ignored when an equivalent panel is
    // already open, exactly as re-opening an open id focuses it rather than duplicating.
    let resolvedId = id;
    if (options?.dedupeKey !== undefined) {
      const match = Object.values(this.s.panels).find(p => p.component === component && p.dedupeKey === options.dedupeKey);
      if (match) resolvedId = match.id;
    }

    const existing = this.s.panels[resolvedId];
    const shouldFocus = options?.focus !== false;
    const entry = this.registry.get(component);
    const target = options?.initialTarget ?? entry?.defaultOptions?.initialTarget ?? 'docked';
    const favourite = entry?.defaultOptions?.favoritePosition ?? DEFAULT_RECT;

    if (existing) {
      if (existing.state === 'minimized') {
        // Honour where it came from, like `restorePanel` does (vdd D3), and publish the restore
        // and the layout change (vdd D4).
        this.restorePanel(resolvedId, { focus: shouldFocus });
        return;
      }
      // A docked panel no leaf holds is open and unreachable; re-opening docks it again (SD7).
      if (existing.state === 'docked' && findLeafForPanel(this.s.gridRoot, resolvedId) === null) {
        if (typeof ngDevMode === 'undefined' || ngDevMode) this.warn(`Panel "${resolvedId}" was open but in no group; docking it again.`);
        this.dockPanel(resolvedId);
        if (shouldFocus) this.activatePanel(resolvedId);
        return;
      }
      // Re-opening an open panel makes it the active one; a pop-out's window isn't brought
      // forward (rdd 7.12.0: only focusPanel / focusPanelWindow do that).
      if (shouldFocus) this.activatePanel(resolvedId);
      return;
    }

    const inputsProvided = options?.inputs !== undefined;
    // dockTo beside a docked panel wins over the target (1.7.0).
    const dockTo = options?.dockTo;
    const dockLeaf = dockTo ? findLeafForPanel(this.s.gridRoot, dockTo.panel) : null;
    if (dockTo && dockLeaf === null && (typeof ngDevMode === 'undefined' || ngDevMode)) {
      this.warn(`openPanel("${resolvedId}") could not dock beside "${dockTo.panel}": that panel is not docked ` +
        `(not open, floating or minimised), so the new panel was placed as usual.`);
    }

    const info: PanelInfo = {
      id: resolvedId,
      title: options?.title ?? entry?.defaultOptions?.title ?? resolvedId,
      component,
      state: dockLeaf === null && target === 'floating' ? 'floating' : 'docked',
      serializable: inputsProvided ? isSerializable(options!.inputs) : true,
      ...(inputsProvided ? { props: options!.inputs as Record<string, unknown> } : {}),
      ...(options?.dedupeKey !== undefined ? { dedupeKey: options.dedupeKey } : {}),
    };
    this.setPanel(resolvedId, info);

    if (dockTo && dockLeaf !== null) {
      const share = Math.min(0.9, Math.max(0.1, dockTo.size ?? this.s.splitRatio));
      this.set({
        gridRoot: dockTo.position === 'center'
          ? addPanelToLeaf(this.s.gridRoot, dockLeaf, resolvedId, { select: shouldFocus })
          : splitLeafInTree(this.s.gridRoot, dockLeaf, resolvedId, dockTo.position, share),
      });
    } else if (target === 'floating') {
      this.addFloating(resolvedId, this.cascade(favourite), options?.anchor ?? entry?.defaultOptions?.defaultAnchor ?? null);
    } else {
      const leaf = findFirstLeafId(this.s.gridRoot) ?? emptyRoot().id;
      this.set({ gridRoot: addPanelToLeaf(this.s.gridRoot, leaf, resolvedId, { select: shouldFocus }) });
    }

    this.resolveActive(shouldFocus ? resolvedId : null);
    this.bus.emit('panel:opened', { id: resolvedId, component });
    this.layoutChanged();
  }

  closePanel(id: string): void {
    const panel = this.s.panels[id];
    if (!panel) return;
    if (this.optionsOf(id).canClose === false) return;
    this.closeGuards.delete(id);
    this.stateProviders.delete(id);
    this.detach(id);
    const next = { ...this.s.panels };
    delete next[id];
    this.set({ panels: next });
    this.resolveActive();
    this.bus.emit('panel:closed', { id });
    this.layoutChanged();
    if (panel.poppedOut) this.forgetPopOut(id);
    // A hosted panel closed from the page (×, menu, the app's closePanel): its widget closes too.
    // A hosted panel can always close. The handler belongs to the widget's overlay.
    if (panel.owner) this.hostedCloseHandlers.get(id)?.();
  }

  // ── hosted panels: a managed widget moved out of its owner panel (rdd 7.11.0) ──
  // They exist only at runtime: saveLayout skips them and loadLayout never creates one.

  /**
   * @internal Opens a hosted panel: one showing a managed widget moved out of its owner panel.
   * Docks beside `at.dockTo.panel` (a split, or a tab for `'center'`), or floats at exactly
   * `at.rect`, never cascaded. Refuses, changing nothing, when that panel isn't docked or the id
   * is taken.
   */
  openHostedPanel(id: string, owner: PanelOwner, title: Label, at: HostedPanelPlacement): boolean {
    if (id in this.s.panels) return false;
    const leaf = at.kind === 'dock' ? findLeafForPanel(this.s.gridRoot, at.dockTo.panel) : null;
    if (at.kind === 'dock' && leaf === null) return false;

    this.setPanel(id, {
      id,
      title,
      component: HOSTED_COMPONENT,
      state: at.kind === 'dock' ? 'docked' : 'floating',
      serializable: false,
      owner,
    });
    if (at.kind === 'float') {
      this.addFloating(id, { ...at.rect }, null); // exactly where asked: never cascaded
    } else {
      const share = Math.min(0.9, Math.max(0.1, at.dockTo.size ?? this.s.splitRatio));
      this.set({
        gridRoot: at.dockTo.position === 'center'
          ? addPanelToLeaf(this.s.gridRoot, leaf!, id)
          : splitLeafInTree(this.s.gridRoot, leaf!, id, at.dockTo.position, share),
      });
    }

    this.resolveActive(id);
    this.bus.emit('panel:opened', { id, component: HOSTED_COMPONENT });
    this.layoutChanged();
    return true;
  }

  /** @internal Removes a hosted panel without its close handler: the widget is going back. */
  removeHostedPanel(id: string): void {
    const panel = this.s.panels[id];
    if (!panel?.owner) return;
    this.detach(id);
    const next = { ...this.s.panels };
    delete next[id];
    this.set({ panels: next });
    this.resolveActive();
    this.bus.emit('panel:closed', { id });
    this.layoutChanged();
    if (panel.poppedOut) this.forgetPopOut(id);
  }

  /** @internal Updates a hosted panel's own capabilities (the widget re-opened). Unchanged is a no-op. */
  setHostedOptions(id: string, options: NonNullable<PanelOwner['options']>): void {
    const panel = this.s.panels[id];
    if (!panel?.owner) return;
    const was = panel.owner.options;
    if (was?.canFloat === options.canFloat && was?.canDock === options.canDock) return;
    this.setPanel(id, { ...panel, owner: { ...panel.owner, options } });
  }

  /**
   * @internal `onClose` is called when a hosted panel is closed (×, menu, `closePanel`): the widget
   * closes. `onDrop`, just before a `loadLayout` drops it: the widget is about to go home.
   * Returns the unregister function.
   */
  registerHostedCloseHandler(id: string, onClose: () => void, onDrop?: () => void): () => void {
    this.hostedCloseHandlers.set(id, onClose);
    if (onDrop) this.hostedDropHandlers.set(id, onDrop);
    return () => {
      if (this.hostedCloseHandlers.get(id) === onClose) this.hostedCloseHandlers.delete(id);
      if (onDrop && this.hostedDropHandlers.get(id) === onDrop) this.hostedDropHandlers.delete(id);
    };
  }

  async requestClosePanel(id: string, options?: RequestCloseOptions): Promise<void> {
    if (options?.force) {
      this.closePanel(id);
      return;
    }
    const guard = this.closeGuards.get(id);
    if (guard && !(await guard())) return;
    const panel = this.s.panels[id];
    if (panel?.dirty) {
      // The built-in question is the default, so no call site has to know about it — a tab's
      // ×, a window's ×, a taskbar menu and `PanelRef.close()` all get it for free.
      const confirm =
        options?.onConfirm ??
        ((dirtyOptions?: DirtyStateOptions) => this.overlays.confirmDiscard({ title: this.format(panel.title), dirtyOptions }));
      if (!(await confirm(panel.dirtyOptions))) return;
    }
    this.closePanel(id);
  }

  minimizePanel(id: string): void {
    // Minimised from its window: it remembers its group, not the hidden floating entry (1.12.0).
    this.endPopOut(id);
    const panel = this.s.panels[id];
    if (!panel || panel.state === 'minimized') return;
    if (this.optionsOf(id).canMinimize === false) return;

    let lastFloatingRect: PanelInfo['lastFloatingRect'];
    let lastLeafId: string | undefined;
    if (panel.state === 'floating') {
      const win = this.s.floating.find(w => w.id === id);
      if (win) {
        lastFloatingRect = {
          x: Number(win.x),
          y: Number(win.y),
          width: Number(win.width),
          height: Number(win.height),
          anchor: win.anchor ?? null,
        };
      }
    } else {
      lastLeafId = findLeafForPanel(this.s.gridRoot, id) ?? undefined;
    }

    this.detach(id);
    this.setPanel(id, { ...panel, state: 'minimized', previousState: panel.state, lastFloatingRect, lastLeafId });
    this.set({ minimized: [...this.s.minimized, { id, title: panel.title, component: panel.component }] });
    this.resolveActive();
    this.bus.emit('panel:minimized', { id });
    this.layoutChanged();
  }

  restorePanel(id: string, options?: { focus?: boolean }): void {
    const panel = this.s.panels[id];
    if (!panel || panel.state !== 'minimized') return;
    const shouldFocus = options?.focus !== false;

    this.set({ minimized: this.s.minimized.filter(m => m.id !== id) });
    const previous = panel.previousState ?? 'docked';
    const favourite = panel.lastFloatingRect ?? optionsFor(this.registry, panel)?.favoritePosition ?? DEFAULT_RECT;

    const toFloating = () => {
      this.setPanel(id, { ...panel, state: 'floating' });
      this.addFloating(id, this.cascade(favourite), panel.lastFloatingRect?.anchor ?? null);
    };
    const toLeaf = (leafId: string) => {
      this.setPanel(id, { ...panel, state: 'docked' });
      this.set({ gridRoot: addPanelToLeaf(this.s.gridRoot, leafId, id, { select: shouldFocus }) });
    };

    if (previous === 'floating') toFloating();
    else if (panel.lastLeafId && leafExists(this.s.gridRoot, panel.lastLeafId)) toLeaf(panel.lastLeafId);
    else if (this.optionsOf(id).canDrag !== false) toFloating(); // its leaf is gone; float it if it may
    else toLeaf(findFirstLeafId(this.s.gridRoot) ?? emptyRoot().id);

    this.resolveActive(shouldFocus ? id : null);
    this.bus.emit('panel:restored', { id });
    this.layoutChanged();
  }

  floatPanel(id: string, rect?: { x: number; y: number; width: number; height: number }, anchor?: FloatAnchor | null): void {
    const panel = this.s.panels[id];
    if (!panel) return;
    // A panel in its own window (1.12.0) has no window here to place: ignored until it returns.
    if (panel.poppedOut) return;
    if (this.optionsOf(id).canDrag === false) return;
    const favourite = rect ?? optionsFor(this.registry, panel)?.favoritePosition ?? DEFAULT_RECT;
    this.detach(id);
    this.setPanel(id, { ...panel, state: 'floating' });
    this.addFloating(id, this.cascade(favourite), anchor ?? null);
    this.resolveActive(id);
    this.layoutChanged();
  }

  dockPanel(id: string, targetLeafId?: string): void {
    this.endPopOut(id);
    const panel = this.s.panels[id];
    if (!panel) return;
    this.detach(id);
    // `lastLeafId` can name a leaf that has since been removed; docking there would put the
    // panel nowhere, so it falls back to the first real group.
    const remembered = panel.lastLeafId && leafExists(this.s.gridRoot, panel.lastLeafId) ? panel.lastLeafId : undefined;
    const leafId = targetLeafId ?? remembered ?? findFirstLeafId(this.s.gridRoot) ?? emptyRoot().id;
    this.setPanel(id, { ...panel, state: 'docked' });
    this.set({ gridRoot: addPanelToLeaf(this.s.gridRoot, leafId, id) });
    this.resolveActive(id);
    this.layoutChanged();
  }

  dockPanelToGroup(id: string, targetLeafId: string, position: DropPosition): void {
    this.endPopOut(id);
    const panel = this.s.panels[id];
    if (!panel) return;
    if (this.placementIsPointless(id, targetLeafId, 'dockPanelToGroup')) return;
    this.detach(id);
    this.setPanel(id, { ...panel, state: 'docked' });
    this.set({
      gridRoot:
        position === 'center'
          ? addPanelToLeaf(this.s.gridRoot, targetLeafId, id)
          : splitLeafInTree(this.s.gridRoot, targetLeafId, id, position, this.s.splitRatio),
      draggedPanelId: null,
    });
    this.resolveActive(id);
    this.layoutChanged();
  }

  dockPanelToWorkspaceEdge(id: string, position: SplitDirection): void {
    this.endPopOut(id);
    const panel = this.s.panels[id];
    if (!panel) return;
    // The only docked panel already fills the workspace; docking it to an edge asks for the
    // layout it has, and acting on it left an empty group beside it.
    if (removePanelFromTree(this.s.gridRoot, id) === null) return;
    this.detach(id);
    this.setPanel(id, { ...panel, state: 'docked' });
    this.set({ gridRoot: dockToEdge(this.s.gridRoot, id, position, this.s.edgeSplitRatio), draggedPanelId: null });
    this.resolveActive(id);
    this.layoutChanged();
  }

  movePanelOrder(panelId: string, targetLeafId: string, targetIndex: number): void {
    const panel = this.s.panels[panelId];
    if (!panel) return;
    if (this.placementIsPointless(panelId, targetLeafId, 'movePanelOrder')) return;
    // Out of its window and into the group, as rdd's windows registry ends it: no stop on the way.
    if (panel.poppedOut) this.clearPoppedOut(panelId, false);
    const cleaned = removePanelFromTree(this.s.gridRoot, panelId) ?? emptyRoot();
    this.set({
      floating: this.s.floating.filter(w => w.id !== panelId),
      minimized: this.s.minimized.filter(m => m.id !== panelId),
    });
    this.setPanel(panelId, { ...this.s.panels[panelId]!, state: 'docked' });
    this.set({ gridRoot: insertPanelInLeaf(cleaned, targetLeafId, panelId, targetIndex), draggedPanelId: null });
    this.resolveActive(panelId);
    this.layoutChanged();
  }

  /**
   * Toggle a panel between filling the workspace and its previous size. A minimised panel is
   * restored first — rdd's equivalent silently did nothing (vdd D1).
   */
  maximizePanel(id: string): void {
    // Nor one to maximise (1.12.0).
    if (this.s.panels[id]?.poppedOut) return;
    if (this.s.panels[id]?.state === 'minimized') this.restorePanel(id);
    const panel = this.s.panels[id];
    if (!panel) return;
    if (panel.state === 'docked') this.floatPanel(id);
    this.set({ floating: this.s.floating.map(w => (w.id === id ? { ...w, maximized: !w.maximized } : w)) });
    this.resolveActive(id);
    this.layoutChanged();
  }

  /**
   * Makes a panel the active one: a floating window comes to the front, a docked panel's tab is
   * selected. A panel in its own window (1.12.0) also brings that window forward, best effort.
   */
  focusPanel(id: string): void;
  /**
   * As `focusPanel(id)`; with `restore: true` a minimised panel is restored first (through
   * `restorePanel`, events included), then focused. Without it a minimised panel stays minimised,
   * as before. (rdd 7.11.0)
   */
  focusPanel(id: string, options: { restore?: boolean }): void;
  focusPanel(id: string, options?: { restore?: boolean }): void {
    // Restoring brings it back and focuses it, with restorePanel's events (rdd 7.11.0).
    if (options?.restore && this.s.panels[id]?.state === 'minimized') {
      this.restorePanel(id);
      return;
    }
    const panel = this.s.panels[id];
    if (!panel) return;
    if (panel.state === 'floating') {
      const win = this.s.floating.find(w => w.id === id);
      if (win && this.s.floating.some(w => w.z > win.z)) {
        this.maxZ += 1;
        const z = this.maxZ;
        this.set({ floating: this.s.floating.map(w => (w.id === id ? { ...w, z } : w)) });
      }
    } else if (panel.state === 'docked') {
      this.set({ gridRoot: selectPanelInTree(this.s.gridRoot, id) });
    }
    // An explicit focus on a minimised panel is honoured as a deliberate caller decision,
    // matching rdd. `resolveActive` would refuse it, so set it directly.
    if (panel.state === 'minimized') {
      const previous = this.s.activePanelId;
      if (previous !== id) {
        this.set({ activePanelId: id });
        this.bus.emit('panel:activated', { id, previous });
      }
      return;
    }
    this.resolveActive(id);
    // A panel in its own window: that window comes forward too, best effort (1.12.0, rdd 7.12.0).
    if (panel.poppedOut && this.focusOwnWindow) this.popOutWindows?.focusWindow(id);
  }

  closeLeafGroup(leafId: string): void {
    this.set({ gridRoot: removeLeafFromTree(this.s.gridRoot, leafId) ?? emptyRoot() });
    this.resolveActive();
    this.layoutChanged();
  }

  updateSplitSizes(path: number[], sizes: number[]): void {
    this.set({ gridRoot: updateSizesAtPath(this.s.gridRoot, path, sizes) });
    this.layoutChanged();
  }

  updateFloatingPosition(id: string, updates: Partial<Pick<FloatingWindow, 'x' | 'y' | 'width' | 'height' | 'anchor'>>): void {
    this.set({ floating: this.s.floating.map(w => (w.id === id ? { ...w, ...updates } : w)) });
  }

  setPanelDirty(id: string, dirty: boolean, options?: DirtyStateOptions): void {
    const panel = this.s.panels[id];
    if (!panel) return;
    // Unchanged is a no-op, so a caller re-asserting the same state publishes nothing.
    if ((panel.dirty ?? false) === dirty && panel.dirtyOptions === options) return;
    this.setPanel(id, { ...panel, dirty, dirtyOptions: options });
  }

  updatePanelTitle(id: string, title: Label): void {
    const panel = this.s.panels[id];
    if (!panel || panel.title === title) return;
    this.setPanel(id, { ...panel, title });
    if (this.s.minimized.some(m => m.id === id)) {
      this.set({ minimized: this.s.minimized.map(m => (m.id === id ? { ...m, title } : m)) });
    }
  }

  /**
   * Replaces an open panel's props, or derives them from the current ones (rdd 7.11.0). The panel
   * re-renders with them (each one its component declares as an input is set again, as on open),
   * `serializable` is re-checked (so the next `saveLayout()` saves or excludes it accordingly), and
   * `layout:changed` is emitted. Nothing for a panel that isn't open, or for a managed widget's
   * own panel, which has no props of its own.
   *
   * ```ts
   * workspace.updatePanelProps('doc-1', prev => ({ ...prev, page: 3 }));
   * ```
   */
  updatePanelProps(
    id: string,
    props: Record<string, unknown> | ((prev: Record<string, unknown> | undefined) => Record<string, unknown>),
  ): void {
    const panel = this.s.panels[id];
    if (!panel || panel.owner) return; // a hosted panel has no props of its own
    const next = typeof props === 'function' ? props(panel.props) : props;
    this.setPanel(id, { ...panel, props: next, serializable: isSerializable(next) });
    this.layoutChanged();
  }

  /**
   * Sets an open panel's tab, window and taskbar icon; `null` restores its registration's icon.
   * Not saved by `saveLayout()`. Publishes no event. An unknown id does nothing (1.10.0).
   */
  setPanelIcon(id: string, icon: NddIcon | null): void {
    const panel = this.s.panels[id];
    if (!panel) return;
    const next = icon ?? undefined;
    if (panel.icon === next) return;
    this.setPanel(id, { ...panel, icon: next });
  }

  setDirection(dir: 'ltr' | 'rtl'): void {
    if (this.s.dir === dir) return;
    this.set({ dir, isRtl: dir === 'rtl' });
  }

  /** @internal drives drag visuals */
  setDraggedPanelId(id: string | null): void {
    this.set({ draggedPanelId: id });
  }

  // ── pop-out windows (1.12.0, rdd 7.12.0): a panel shown in its own browser window ──
  // A popped-out panel is a floating panel with a flag; the workspace draws no frame for it, and
  // the window itself belongs to the windows registry bound with `bindPopOutWindows`. Everything
  // below that works out a place does it on a copy (`Snapshot`), as rdd's reducers do, and the
  // result is written to the live state in one go.

  /**
   * Brings forward the window that holds a panel, and makes it the active panel (1.12.0, rdd
   * 7.12.0): its pop-out for a panel in its own window (a widget's panel too), the main window for
   * one in the page. Best effort: a browser may keep another window in front. `ok` is false for an
   * id that isn't open.
   *
   * ```ts
   * // From a widget in its own window: bring its owner panel's window forward.
   * workspace.focusPanelWindow(injectWidget()!.ownerPanelId!);
   * ```
   */
  focusPanelWindow(id: string): { ok: boolean } {
    const panel = this.s.panels[id];
    if (!panel) return { ok: false };
    this.activatePanel(id);
    if (!(panel.poppedOut && this.popOutWindows?.focusWindow(id)) && typeof window !== 'undefined') {
      try {
        window.focus();
      } catch {
        /* best effort */
      }
    }
    return { ok: true };
  }

  /**
   * Moves a panel into its own browser window (1.12.0, rdd 7.12.0), for a second monitor. Nothing
   * is re-created: the panel's state, scroll offsets and a canvas's WebGL context go with it. A
   * docked panel remembers its group and goes back into it on return.
   *
   * Call it inside the user's click or key press: browsers only open a window then. A click in
   * one of the app's pop-out windows counts too. It is synchronous, and says what happened (see
   * {@link PopOutResult}); on a refusal the panel stays where it is and nothing is shown to the
   * user, so the app decides what to say. Calling it for a panel that is already out brings its
   * window forward.
   *
   * Needs `popOut: true` on the workspace and the panel type's `defaultOptions.canPopOut`. The
   * window opens the desktop's `popoutUrl`, or a blank window. When that page can't be used after
   * all (another origin, or it doesn't load within 10 s), the panel comes back and the window
   * closes, after this has returned `{ ok: true }`.
   *
   * On `{ ok: true }`, `panel:popping-out` was sent during the call, with the panel still in the
   * page; `panel:popped-out` follows once it is laid out in the window, or `panel:returned` when the
   * window fails first.
   *
   * ```ts
   * onPopOut(): void {
   *   const result = this.workspace.popOutPanel('chart-1');
   *   if (!result.ok && result.reason === 'blocked') alert('Allow pop-ups for this site.');
   * }
   * ```
   */
  popOutPanel(id: string): PopOutResult {
    if (!this.popOutEnabled) {
      if (!this.warnedPopOutDisabled) {
        this.warnedPopOutDisabled = true;
        if (typeof ngDevMode === 'undefined' || ngDevMode)
          this.warn(`popOutPanel("${id}") was refused: this workspace was created without popOut. Pass ` +
            `provideDockableDesktop({ popOut: true }) to let panels open in their own window.`);
      }
      return { ok: false, reason: 'disabled' };
    }
    // No windows registry bound (no <ndd-desktop> to show it): nothing would show the panel there.
    return this.popOutWindows ? this.popOutWindows.popOut(id) : { ok: false, reason: 'no-window' };
  }

  /**
   * Brings a panel back from its own window (1.12.0, rdd 7.12.0), where it was. A panel that was
   * floating floats at its rect. One that was docked goes, in this order:
   * - into the group of its tab-mates, among their tabs, when one of them is docked;
   * - into its own group, when that group was kept and waits empty;
   * - beside the panels it was next to, on the same side at the same size (the nearest part of its
   *   old layout still docked);
   * - into the grid, when no panel is docked there;
   * - otherwise floating, or into the first group for a type that can't float.
   *
   * Panels out at the same time come back, in any order, to the layout they left. The window
   * closes. Closing the window, or its "Return to desktop" button, does the same. `ok` is false
   * when the panel wasn't in a window.
   */
  returnPanel(id: string): { ok: boolean } {
    if (this.popOutWindows) return this.popOutWindows.returnPanel(id);
    if (!this.s.panels[id]?.poppedOut) return { ok: false };
    this.clearPoppedOut(id, true);
    return { ok: true };
  }

  /**
   * @internal Marks an open panel as shown in its own window (1.12.0): a docked or minimised panel
   * becomes floating first, remembering its group. Returns `false`, changing nothing, when the
   * workspace has no `popOut` or there is no such panel.
   */
  setPoppedOut(id: string): boolean {
    if (!this.popOutEnabled || !(id in this.s.panels)) return false;
    const was = this.s.panels[id]!;
    if (was.poppedOut && was.state === 'floating') return true;
    const prev = this.snapshot();
    // Where it is in its layout: worked out on a copy with the panels already out put back. A
    // minimised panel is restored on that copy only, never into the live grid, whose groups may
    // be waiting for those panels.
    const base = this.withReturnPlaces(prev);
    const whole = was.state === 'minimized' ? this.restoredCopy(base, id) : base;
    if (whole.panels[id]?.state === 'docked') {
      // Remembered as minimising does, so returning puts it back in its group.
      const lastLeafId = findLeafForPanel(whole.gridRoot, id) ?? undefined;
      // Its group-mates and neighbours, and those of every panel already out, from that copy:
      // whoever comes back first finds the others where they belong.
      const record = (q: string, seq: number) =>
        this.popOutOrigins.set(q, {
          places: placesBeside(whole.gridRoot, q),
          mates: [...(groupOf(whole.gridRoot, q)?.panels ?? [q])],
          seq,
        });
      for (const q of Object.values(prev.panels)) {
        const o = this.popOutOrigins.get(q.id);
        if (q.poppedOut && q.previousState === 'docked' && o && findLeafForPanel(whole.gridRoot, q.id)) record(q.id, o.seq);
      }
      record(id, ++this.popOutSeq);
      const rect = this.cascade(this.optionsOf(id).favoritePosition ?? DEFAULT_RECT);
      this.detach(id);
      this.setPanel(id, { ...was, state: 'floating', previousState: 'docked', lastLeafId, poppedOut: true });
      this.addFloating(id, rect, null);
    } else {
      // A floating one (a minimised floating one comes back first, where it was).
      if (was.state === 'minimized') {
        this.set({ minimized: this.s.minimized.filter(m => m.id !== id) });
        this.addFloating(
          id,
          this.cascade(was.lastFloatingRect ?? this.optionsOf(id).favoritePosition ?? DEFAULT_RECT),
          was.lastFloatingRect?.anchor ?? null,
        );
      }
      this.popOutOrigins.set(id, { places: [], mates: [id], seq: ++this.popOutSeq });
      this.setPanel(id, { ...was, state: 'floating', previousState: 'floating', lastLeafId: undefined, poppedOut: true });
    }
    this.resolveActive(id);
    this.layoutChanged();
    return true;
  }

  /**
   * @internal Clears a panel's pop-out flag (1.12.0). With `restorePlace`, a panel that was docked
   * goes back where it was: its tab-mates' group, its own kept empty group, beside the panels it was
   * next to, the grid when no panel is docked, else floating (or the first group for a type that
   * can't float). See {@link Workspace.returnPanel}.
   */
  clearPoppedOut(id: string, restorePlace: boolean): void {
    const panel = this.s.panels[id];
    if (!panel?.poppedOut) {
      this.popOutOrigins.delete(id);
      return;
    }
    let moved = false;
    if (restorePlace) {
      const next = this.returnPlace(this.snapshot(), id, true);
      moved = next.panels[id]?.state !== panel.state;
      this.applySnapshot(next);
    } else {
      const { poppedOut: _flag, ...rest } = panel;
      this.setPanel(id, rest);
    }
    this.forgetPopOut(id);
    if (moved) this.layoutChanged();
  }

  /**
   * @internal `cb(id)` runs, synchronously, each time a panel stops being popped out in the store:
   * `clearPoppedOut`, an action from code that brings it back first (minimise, dock, a dock to a
   * group or an edge, a tab move), `closePanel`, `removeHostedPanel`, `loadLayout`. The windows
   * registry closes that panel's window. Returns the function that removes it. (1.12.0)
   */
  onPopOutEnded(cb: (id: string) => void): () => void {
    this.popOutEndListeners.add(cb);
    return () => {
      this.popOutEndListeners.delete(cb);
    };
  }

  /**
   * @internal The windows registry lends `popOutPanel` / `returnPanel` / `focusPanelWindow` their
   * windows. Returns the function that takes them back. Until one is bound, `popOutPanel` returns
   * `'no-window'`. (1.12.0)
   */
  bindPopOutWindows(windows: PopOutWindowsBinding): () => void {
    this.popOutWindows = windows;
    return () => {
      if (this.popOutWindows === windows) this.popOutWindows = null;
    };
  }

  /** The layout part of the state: what a return place is worked out on. */
  private snapshot(): Snapshot {
    const s = this.s;
    return { gridRoot: s.gridRoot, floating: s.floating, minimized: s.minimized, panels: s.panels, activePanelId: s.activePanelId };
  }

  /** The panel is no longer popped out in the store: its record goes, and the windows hear of it. */
  private forgetPopOut(id: string): void {
    this.popOutOrigins.delete(id);
    for (const cb of [...this.popOutEndListeners]) cb(id);
  }

  /** An action that moves a popped-out panel from code brings it back where it was first. */
  private endPopOut(id: string): void {
    if (this.s.panels[id]?.poppedOut) this.clearPoppedOut(id, true);
  }

  /** `s` with `id` restored from the taskbar, on the copy only (its floating list is not used). */
  private restoredCopy(s: Snapshot, id: string): Snapshot {
    const panel = s.panels[id];
    if (!panel || panel.state !== 'minimized') return s;
    const minimized = s.minimized.filter(m => m.id !== id);
    const toLeaf = (leafId: string): Snapshot => ({
      ...s,
      minimized,
      gridRoot: addPanelToLeaf(s.gridRoot, leafId, id),
      panels: { ...s.panels, [id]: { ...panel, state: 'docked' } },
    });
    const toFloating = (): Snapshot => ({ ...s, minimized, panels: { ...s.panels, [id]: { ...panel, state: 'floating' } } });
    if ((panel.previousState ?? 'docked') === 'floating') return toFloating();
    if (panel.lastLeafId && leafExists(s.gridRoot, panel.lastLeafId)) return toLeaf(panel.lastLeafId);
    if (optionsFor(this.registry, panel)?.canDrag !== false) return toFloating();
    return toLeaf(findFirstLeafId(s.gridRoot) ?? emptyRoot().id);
  }

  /** `s` with `id` docked into the first group (rdd's `applyDock` with no target). */
  private dockedCopy(s: Snapshot, id: string, activate: boolean): Snapshot {
    const panel = s.panels[id];
    if (!panel) return s;
    const cleanRoot = removePanelFromTree(s.gridRoot, id) ?? emptyRoot();
    const leafId = findFirstLeafId(cleanRoot) ?? emptyRoot().id;
    const next: Snapshot = {
      ...s,
      gridRoot: addPanelToLeaf(cleanRoot, leafId, id),
      floating: s.floating.filter(w => w.id !== id),
      panels: { ...s.panels, [id]: { ...panel, state: 'docked' } },
    };
    return { ...next, activePanelId: resolveActivePanelId(next, activate ? id : null) };
  }

  /**
   * `s` with every popped-out panel at its return place, the last one out first: the layout from
   * before they left. Pure; the live state is untouched.
   */
  private withReturnPlaces(s: Snapshot): Snapshot {
    const out = Object.values(s.panels)
      .filter(p => p.poppedOut)
      .sort((x, y) => (this.popOutOrigins.get(y.id)?.seq ?? 0) - (this.popOutOrigins.get(x.id)?.seq ?? 0));
    return out.reduce((acc, p) => this.returnPlace(acc, p.id, false), s);
  }

  /**
   * Where a popped-out panel goes back, as a state: the flag cleared, and a panel that was docked
   * into its tab-mates' group; else its own group while it waits empty (kept); else beside the
   * panels it was next to, on the same side at the same share; else into the grid when no panel is
   * docked; else floating where it is, or into the first group when its type can't float. A panel
   * that was floating stays at its rect. Pure: the return and `saveLayout()` both use it, so a saved
   * layout is the one the panel would come back to.
   */
  private returnPlace(s: Snapshot, id: string, activate: boolean): Snapshot {
    const p = s.panels[id];
    if (!p?.poppedOut) return s;
    const { poppedOut: _flag, ...panel } = p;
    const cleared: Snapshot = { ...s, panels: { ...s.panels, [id]: panel } };
    if (panel.state !== 'floating' || panel.previousState !== 'docked') return cleared;
    const origin = this.popOutOrigins.get(id);
    const docked = (gridRoot: LayoutNode): Snapshot => {
      const next: Snapshot = {
        ...cleared,
        gridRoot,
        floating: cleared.floating.filter(w => w.id !== id),
        panels: { ...cleared.panels, [id]: { ...panel, state: 'docked' } },
      };
      return { ...next, activePanelId: resolveActivePanelId(next, activate ? id : null) };
    };
    const mates = origin?.mates ?? [id];
    // Its group is where its group-mates are: the group of the nearest one docked, among their tabs.
    const k = mates.indexOf(id);
    const byDistance = mates
      .filter(m => m !== id)
      .sort((x, y) => Math.abs(mates.indexOf(x) - k) - Math.abs(mates.indexOf(y) - k));
    for (const mate of byDistance) {
      const group = groupOf(cleared.gridRoot, mate);
      if (group) return docked(insertPanelAmongMates(cleared.gridRoot, group.id, id, mates, activate));
    }
    // With none docked, its old group counts only while it is empty (a kept group): a group with that
    // id holding other panels is a new one (the empty grid's id is reused).
    const own = panel.lastLeafId ? findLeaf(cleared.gridRoot, panel.lastLeafId) : null;
    if (own && own.panels.length === 0) return docked(insertPanelAmongMates(cleared.gridRoot, own.id, id, mates, activate));
    // Beside the nearest part of its old layout still docked (innermost split first).
    // Unique: several returns can run in one millisecond (a save puts every panel back on a copy).
    const leafId = `group-popout-${Date.now()}-${++this.popOutLeafSeq}`;
    // Panels still out don't count against a split's old sizes: they are on their way back. One
    // whose own group was kept and waits empty is there, in its group's place (it stands in).
    const outPanels = Object.values(cleared.panels).filter(q => q.poppedOut);
    const out = new Set(outPanels.map(q => q.id));
    const standIn = new Map<string, string>();
    for (const q of outPanels) {
      const kept = q.previousState === 'docked' && q.lastLeafId ? findLeaf(cleared.gridRoot, q.lastLeafId) : null;
      if (kept && kept.panels.length === 0) standIn.set(q.id, kept.id);
    }
    for (const place of origin?.places ?? []) {
      const gridRoot = returnBeside(cleared.gridRoot, id, place, leafId, out, standIn);
      if (gridRoot) return docked(gridRoot);
    }
    // Nothing of its old layout is docked and no panel is in the grid (they are all out, or it was
    // the whole grid; kept-empty groups may remain): into its first group that waits for no other
    // panel. The next one back finds it.
    const waiting = new Set(standIn.values());
    const first = leavesOf(cleared.gridRoot).find(l => !waiting.has(l.id));
    if (origin && first && !hasDockedPanel(cleared.gridRoot)) {
      return docked(insertPanelAmongMates(cleared.gridRoot, first.id, id, mates, activate));
    }
    const options = optionsFor(this.registry, panel);
    if (options?.canDrag === false || options?.canFloat === false) return this.dockedCopy(cleared, id, activate);
    return cleared;
  }

  /**
   * Writes a copy worked out above to the live state. The copy's active panel is only a
   * preference: `resolveActive`, the one resolution point (vdd D2), decides on the live state and
   * sends `panel:activated` when that changed.
   */
  private applySnapshot(next: Snapshot): void {
    const s = this.s;
    const patch: Partial<WorkspaceState> = {};
    if (next.gridRoot !== s.gridRoot) patch.gridRoot = next.gridRoot;
    if (next.floating !== s.floating) patch.floating = next.floating;
    if (next.minimized !== s.minimized) patch.minimized = next.minimized;
    if (next.panels !== s.panels) patch.panels = next.panels;
    if (Object.keys(patch).length > 0) this.set(patch);
    this.resolveActive(next.activePanelId);
  }

  // ── queries ────────────────────────────────────────────────────────────────

  isOpen(id: string): boolean {
    return id in this.s.panels;
  }

  getOpenPanelIds(): string[] {
    return Object.keys(this.s.panels);
  }

  findPanelId(component: string, dedupeKey: string): string | null {
    return Object.values(this.s.panels).find(p => p.component === component && p.dedupeKey === dedupeKey)?.id ?? null;
  }

  // ── persistence ────────────────────────────────────────────────────────────

  saveLayout(): string {
    // A panel in its own window is saved where it would come back to (1.12.0): the layout is the
    // one it would have had, had it never left. The live state is not touched.
    const raw = this.withReturnPlaces(this.snapshot());
    const excluded: string[] = [];
    const included: Record<string, PanelInfo> = {};
    // Hosted panels (rdd 7.11.0) are never saved and never reported as excluded: the owner panel
    // saves its widgets itself.
    const hosted: string[] = [];
    // A registered provider is pulled fresh on every save: serialisability can change over a
    // panel's lifetime, so it is never cached from open time for provider-backed panels.
    for (const [id, info] of Object.entries(raw.panels)) {
      if (info.owner || info.component === HOSTED_COMPONENT) {
        hosted.push(id);
        continue;
      }
      const provider = this.stateProviders.get(id);
      const dynamic = provider?.();
      const hasDynamic = provider !== undefined && dynamic !== undefined;
      const ok = hasDynamic ? isSerializable(dynamic) : info.serializable;
      // The runtime icon (1.10.0) is a component, template or class string: never part of a saved
      // layout. A function title (1.3.0) can't be saved; the restored panel takes its registered default.
      const { icon: _icon, ...saved } = info;
      if (typeof saved.title === 'function') delete (saved as Partial<PanelInfo>).title;
      if (ok) included[id] = hasDynamic ? { ...saved, props: dynamic as Record<string, unknown>, serializable: true } : saved;
      else excluded.push(id);
    }
    // Excluded panels are pruned from the snapshot's tree/floating/minimized too, so a restore
    // never references a panel it has no data to recreate. The live state is untouched.
    let gridRoot: LayoutNode = raw.gridRoot;
    let floating = raw.floating;
    let minimized = raw.minimized;
    for (const id of [...excluded, ...hosted]) {
      gridRoot = removePanelFromTree(gridRoot, id) ?? emptyRoot();
      floating = floating.filter(w => w.id !== id);
      minimized = minimized.filter(m => m.id !== id);
    }
    if (excluded.length) {
      this.bus.emit('layout:panels-excluded', { panels: excluded.map(id => ({ id, component: raw.panels[id]!.component })) });
    }
    // Validated against the *pruned* snapshot: if the active panel was excluded, it is omitted.
    const live = raw.activePanelId;
    const activePanelId = live !== null && isVisibleActiveTarget(live, { gridRoot, floating, panels: included }) ? live : null;
    const payload: SerializedLayout = {
      version: LAYOUT_VERSION,
      ...(activePanelId !== null ? { activePanelId } : {}),
      gridRoot,
      floating,
      minimized: minimized.map(m => (typeof m.title === 'function' ? { id: m.id, component: m.component } : m)) as SerializedLayout['minimized'],
      panels: included,
    };
    return JSON.stringify(payload);
  }

  loadLayout(json: string): boolean {
    let parsed: ReturnType<typeof parseInitialState>;
    try {
      const payload = JSON.parse(json);
      const result = parseInitialState(JSON.stringify(payload), (typeof ngDevMode === 'undefined' || ngDevMode) ? m => this.warn(m) : undefined);
      if (!payload || typeof payload !== 'object' || !payload.gridRoot) return false;
      parsed = this.withTitles(result);
    } catch {
      if (typeof ngDevMode === 'undefined' || ngDevMode) this.warn('loadLayout received invalid JSON; the current layout is unchanged.');
      return false;
    }
    // The live hosted panels are about to go: tell their owners first, while their content is
    // still in place. (The parse above already dropped any hosted panel the layout named.)
    for (const [id, panel] of Object.entries(this.s.panels)) {
      if (panel.owner) this.hostedDropHandlers.get(id)?.();
    }
    const previous = this.s.activePanelId;
    // No panel of a loaded layout is in a window: each one out now loses its window (1.12.0).
    const wereOut = Object.values(this.s.panels).filter(p => p.poppedOut).map(p => p.id);
    // A panel that stays open keeps its runtime icon: the component that set it isn't re-created,
    // so it wouldn't set it again (1.10.0).
    const panels: Record<string, PanelInfo> = {};
    for (const [id, info] of Object.entries(parsed.panels)) {
      const was = this.s.panels[id];
      panels[id] = was?.icon !== undefined && was.component === info.component ? { ...info, icon: was.icon } : info;
    }
    this.set({
      gridRoot: parsed.gridRoot,
      floating: parsed.floating,
      minimized: parsed.minimized,
      panels,
      draggedPanelId: null,
      activePanelId: parsed.activePanelId,
    });
    this.maxZ = Math.max(this.zIndexBase, ...parsed.floating.map(w => w.z), 0);
    if (previous !== parsed.activePanelId) this.bus.emit('panel:activated', { id: parsed.activePanelId, previous });
    this.popOutOrigins.clear();
    for (const id of wereOut) this.forgetPopOut(id);
    this.layoutChanged();
    return true;
  }

  // ── events ─────────────────────────────────────────────────────────────────

  publish<K extends keyof (TEvents & BuiltInEvents) & string>(event: K, data: (TEvents & BuiltInEvents)[K]): void {
    this.bus.publish(event, data);
  }

  /**
   * @internal Sends one of the library's own events from outside the store (1.12.0): the pop-out
   * windows registry's four `panel:` events.
   */
  emitBuiltIn<K extends keyof BuiltInEvents & string>(event: K, data: BuiltInEvents[K]): void {
    this.bus.emit(event, data);
  }

  /**
   * @internal `focusPanel(id)` without bringing a popped-out panel's window forward (1.12.0): for
   * a press or focus already inside that window, a re-open, and `focusPanelWindow`, which focuses
   * the window itself. rdd's `setActivePanel`.
   */
  activatePanel(id: string): void {
    this.focusOwnWindow = false;
    try {
      this.focusPanel(id);
    } finally {
      this.focusOwnWindow = true;
    }
  }

  /**
   * Listen for an event. Returns the unsubscribe function; **also** unsubscribes by itself when
   * called in an injection context (a component, directive or service constructor) and that
   * context is destroyed — the same contract as `takeUntilDestroyed()`.
   */
  subscribe<K extends keyof (TEvents & BuiltInEvents) & string>(event: K, cb: (data: (TEvents & BuiltInEvents)[K]) => void): () => void {
    const off = this.bus.subscribe(event, cb);
    return this.disposeWithContext(off);
  }

  /** Register `off` with the caller's `DestroyRef`, when there is an injection context. */
  private disposeWithContext(off: () => void): () => void {
    let destroyRef: DestroyRef | null = null;
    try {
      destroyRef = inject(DestroyRef, { optional: true });
    } catch {
      /* not in an injection context: the caller owns the returned function */
    }
    if (!destroyRef) return off;
    const unregister = destroyRef.onDestroy(off);
    return () => {
      unregister();
      off();
    };
  }

  // ── registrations ──────────────────────────────────────────────────────────

  /** Veto a panel's close. Returning `false` (or resolving to it) blocks the close. */
  registerCloseGuard(id: string, guard: () => boolean | Promise<boolean>): () => void {
    this.closeGuards.set(id, guard);
    return () => {
      if (this.closeGuards.get(id) === guard) this.closeGuards.delete(id);
    };
  }

  /** Contribute a panel's live state to `saveLayout()`; pulled fresh on every save. */
  registerStateProvider(id: string, provider: () => unknown): () => void {
    this.stateProviders.set(id, provider);
    return () => {
      if (this.stateProviders.get(id) === provider) this.stateProviders.delete(id);
    };
  }

  /** Contribute extra items to a panel's own context menu. Read each time the menu opens. */
  registerPanelMenu(id: string, getItems: () => ContextMenuItem[]): () => void {
    this.panelMenus.set(id, getItems);
    this.panelMenuVersion.update(v => v + 1);
    return () => {
      if (this.panelMenus.get(id) === getItems) {
        this.panelMenus.delete(id);
        this.panelMenuVersion.update(v => v + 1);
      }
    };
  }

  /** The items a panel has contributed, or an empty list. Reactive to (un)registration. */
  panelMenuItems(id: string): ContextMenuItem[] {
    this.panelMenuVersion();
    return this.panelMenus.get(id)?.() ?? [];
  }

  /**
   * Open a context menu. Callable from anywhere, including outside components — the request
   * is state, and `<ndd-context-menu>` renders whatever is pending.
   */
  showContextMenu(options: ShowContextMenuOptions): void {
    options.event?.preventDefault?.();
    const from = options.event?.target;
    this.menu.set({
      ...menuPosition(options),
      items: options.items,
      initialFocus: menuInitialFocus(options),
      // The opening event's own document (1.12.0): a menu opened in a pop-out window shows there.
      container: isNode(from) ? docOf(from).body : null,
    });
  }

  /** Dismiss the open menu, if any. */
  closeContextMenu(): void {
    this.menu.set(null);
  }

  // ── i18n ───────────────────────────────────────────────────────────────────

  /**
   * A panel saved without a title — it had a function title, which a layout can't hold — takes
   * its registered default title, as a newly opened one would, or its id.
   */
  private withTitles<T extends { panels: Record<string, PanelInfo>; minimized: { id: string; title: PanelInfo['title']; component: string }[] }>(parsed: T): T {
    const panels: Record<string, PanelInfo> = {};
    for (const [id, loaded] of Object.entries(parsed.panels)) {
      // A layout can't hold a runtime icon (1.10.0): one in hand-made JSON is dropped.
      const { icon: _icon, ...info } = loaded;
      panels[id] = info.title ? info : { ...info, title: optionsFor(this.registry, info)?.title || id };
    }
    const minimized = parsed.minimized.map(m => (m.title ? m : { ...m, title: panels[m.id]?.title || m.id }));
    return { ...parsed, panels, minimized };
  }

  /** Resolve a label through the configured formatter. One copy with `formatLabel`, so they can't drift (1.3.1). */
  format(label: Label | undefined): string {
    return formatLabel(label, this.config.formatMessage);
  }

  /** Drop every listener and guard. Called automatically when a provided workspace's injector is destroyed. */
  dispose(): void {
    this.bus.clear();
    this.overlays.dispose();
    this.closeGuards.clear();
    this.stateProviders.clear();
    this.panelMenus.clear();
    this.hostedCloseHandlers.clear();
    this.hostedDropHandlers.clear();
    this.stateListeners.clear();
    this.popOutEndListeners.clear();
    this.popOutOrigins.clear();
    this.popOutWindows = null;
    this.menu.set(null);
  }
}

/** The type-only mark {@link definePanels} puts on a map. No such value exists at runtime. */
declare const panelsBrand: unique symbol;

/** A panel map marked by {@link definePanels}, so `createWorkspace` types `openPanel` from it (1.9.0). */
export type PanelMap<TPanels extends Record<string, PanelDefinition> = Record<string, PanelDefinition>> =
  TPanels & { readonly [panelsBrand]: true };

// Matched with `infer`, not `<unknown>`: Angular's signal types aren't covariant, so an
// `InputSignal<number>` doesn't extend `InputSignalWithTransform<unknown, unknown>`.
/** Whether a member is a signal input: `input()`, `input.required()` or `model()`. */
type IsSignalInput<S> =
  S extends ModelSignal<infer _T> ? true : S extends InputSignalWithTransform<infer _R, infer _W> ? true : false;

/** The value an input accepts: its write type, after any transform. */
type InputValue<S> =
  S extends ModelSignal<infer T> ? T : S extends InputSignalWithTransform<infer _R, infer W> ? W : never;

/** A component's signal inputs, each optional, without `panelId`. */
type SignalInputsOf<C> = {
  [K in keyof C as K extends 'panelId' ? never : IsSignalInput<C[K]> extends true ? K : never]?: InputValue<C[K]>;
};

/**
 * Inputs that aren't typed: any, as without `definePanels`. It must be `any`, not
 * `Record<string, unknown>`: TypeScript only accepts `TypedWorkspace` as a `Workspace` (its
 * `openPanel` narrowing the generic one) when the untyped branches are `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
type UntypedInputs = any;

/** A component class's inputs; untyped when it declares no signal inputs (`@Input()` is invisible to types). */
type InputsOfType<T> = T extends Type<infer C>
  ? (keyof SignalInputsOf<C> extends never ? UntypedInputs : SignalInputsOf<C>)
  : UntypedInputs;

/**
 * The `inputs` `openPanel` passes to a registered panel: its component's signal inputs, without
 * `panelId` (the library sets it). For a `loadComponent`, the loaded component's.
 */
export type PanelInputsOf<TDefinition> =
  TDefinition extends { component: infer T } ? InputsOfType<T>
    : TDefinition extends { loadComponent: () => Promise<infer R> }
      ? (R extends { default: infer T } ? InputsOfType<T> : InputsOfType<R>)
      : UntypedInputs;

/**
 * Mark a panel map for typing (1.9.0). Returns it unchanged; a workspace created from it gets a
 * typed `openPanel`: only registered names, and `inputs` checked against that panel's inputs.
 *
 * ```ts
 * const panels = definePanels({ map: { component: MapPanel }, chart: { component: ChartPanel } });
 * const workspace = createWorkspace({ panels });
 * workspace.openPanel('c1', 'chart', { inputs: { series: 3 } });   // checked against ChartPanel's inputs
 * ```
 */
export function definePanels<const TPanels extends Record<string, PanelDefinition>>(panels: TPanels): PanelMap<TPanels> {
  return panels as PanelMap<TPanels>;
}

/**
 * A workspace created from {@link definePanels}: the same object, with `openPanel` typed from the
 * registry. It goes anywhere a {@link Workspace} goes. `inject(Workspace)` and `injectWorkspace()`
 * stay untyped; keep this one for typed calls.
 */
export interface TypedWorkspace<TPanels extends Record<string, PanelDefinition>, TEvents extends Record<string, unknown> = Record<string, unknown>>
  extends Workspace<TEvents> {
  /** `openPanel`, typed: a registered name, and that panel's inputs. */
  openPanel<K extends keyof TPanels & string>(id: string, component: K, options?: OpenPanelOptions<PanelInputsOf<TPanels[K]>>): void;
}

/**
 * Create a workspace from a map marked by {@link definePanels} (1.9.0): `openPanel` takes only the
 * registered names, with `inputs` checked against each panel's inputs. To name the events as well,
 * pass both type arguments: `createWorkspace<typeof panels, AppEvents>({ panels })`.
 */
export function createWorkspace<TPanels extends Record<string, PanelDefinition>, TEvents extends Record<string, unknown> = Record<string, unknown>>(
  config: WorkspaceConfig & { panels: PanelMap<TPanels> },
): TypedWorkspace<TPanels, TEvents>;
/**
 * Create a workspace outside dependency injection — at module scope, in a test, or before
 * `bootstrapApplication`. It is live immediately: `openPanel()` works with nothing rendered.
 * Hand it to the app with `provideDockableDesktop(workspace)`.
 */
export function createWorkspace<TEvents extends Record<string, unknown> = Record<string, unknown>>(config?: WorkspaceConfig): Workspace<TEvents>;
export function createWorkspace<TEvents extends Record<string, unknown> = Record<string, unknown>>(
  config: WorkspaceConfig = {},
): Workspace<TEvents> {
  return new Workspace<TEvents>(config);
}
