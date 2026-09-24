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
import type { Signal, Type, WritableSignal } from '@angular/core';
import type {
  DirtyStateOptions,
  DropPosition,
  FloatAnchor,
  FloatingWindow,
  Label,
  LayoutNode,
  MessageDescriptor,
  MessageFormatter,
  PanelInfo,
  SerializedLayout,
  SplitDirection,
} from '../core/types';
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
import { LAYOUT_VERSION, parseInitialState } from '../core/serialize';
import { isSerializable } from '../core/serializable';
import { PanelRegistry } from '../core/registry';
import type { PanelDefaultOptions, PanelLoader } from '../core/registry';
import { EventBus } from '../core/event-bus';
import type { BuiltInEvents } from '../core/event-bus';
import { menuPosition } from '../core/context-menu';
import type { ContextMenuItem, ShowContextMenuOptions } from '../core/context-menu';
import { defaultMessages } from '../core/messages';
import { createToolbarState } from '../core/toolbar-state';
import type { ToolbarState } from '../core/toolbar-state';
import { createOverlays } from '../core/overlays';
import type { Overlays } from '../core/overlays';
import { activeContributionSignal, createContributions } from '../core/contributions';
import type { Contributions, PanelContribution } from '../core/contributions';

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
}

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

const DEFAULT_RECT = { x: 300, y: 150, width: 450, height: 350 };

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
  /** Bumped when a panel registers or withdraws menu items, so a `computed` asking "does this
   *  panel contribute anything?" has something to track. The items themselves are pulled. */
  private readonly panelMenuVersion = signal(0);
  private readonly menu = signal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  private readonly _state: WritableSignal<WorkspaceState>;
  private readonly zIndexBase: number;
  private maxZ: number;

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
  readonly contextMenu: Signal<{ x: number; y: number; items: ContextMenuItem[] } | null>;
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
    this.config = { ...config, zIndexBase: this.zIndexBase };
    this.classes = {
      modal: config.classes?.modal ?? '',
      modalBody: config.classes?.modalBody ?? '',
      sidePanel: config.classes?.sidePanel ?? '',
      sidePanelBody: config.classes?.sidePanelBody ?? '',
      window: config.classes?.window ?? '',
      windowBody: config.classes?.windowBody ?? '',
    };

    const initial = parseInitialState(config.initialState, (typeof ngDevMode === 'undefined' || ngDevMode) ? m => this.warn(m) : undefined);
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
    this.activeContribution = activeContributionSignal(this.contributions, () => this._state().activePanelId);
  }

  // ── state plumbing ─────────────────────────────────────────────────────────

  /** The current state, read without tracking — actions must never subscribe their caller. */
  private get s(): WorkspaceState {
    return untracked(this._state);
  }

  private set(patch: Partial<WorkspaceState>): void {
    this._state.set(this.publishable({ ...this.s, ...patch }));
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

  private optionsFor(id: string): PanelDefaultOptions {
    const panel = this.s.panels[id];
    return (panel && this.registry.get(panel.component)?.defaultOptions) || {};
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
        if (shouldFocus) this.focusPanel(resolvedId);
        return;
      }
      if (shouldFocus) this.focusPanel(resolvedId);
      return;
    }

    const inputsProvided = options?.inputs !== undefined;
    const info: PanelInfo = {
      id: resolvedId,
      title: options?.title ?? entry?.defaultOptions?.title ?? resolvedId,
      component,
      state: target === 'floating' ? 'floating' : 'docked',
      serializable: inputsProvided ? isSerializable(options!.inputs) : true,
      ...(inputsProvided ? { props: options!.inputs as Record<string, unknown> } : {}),
      ...(options?.dedupeKey !== undefined ? { dedupeKey: options.dedupeKey } : {}),
    };
    this.setPanel(resolvedId, info);

    if (target === 'floating') {
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
    if (!this.s.panels[id]) return;
    if (this.optionsFor(id).canClose === false) return;
    this.closeGuards.delete(id);
    this.stateProviders.delete(id);
    this.detach(id);
    const next = { ...this.s.panels };
    delete next[id];
    this.set({ panels: next });
    this.resolveActive();
    this.bus.emit('panel:closed', { id });
    this.layoutChanged();
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
    const panel = this.s.panels[id];
    if (!panel || panel.state === 'minimized') return;
    if (this.optionsFor(id).canMinimize === false) return;

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
    const favourite = panel.lastFloatingRect ?? this.registry.get(panel.component)?.defaultOptions?.favoritePosition ?? DEFAULT_RECT;

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
    else if (this.optionsFor(id).canDrag !== false) toFloating(); // its leaf is gone; float it if it may
    else toLeaf(findFirstLeafId(this.s.gridRoot) ?? emptyRoot().id);

    this.resolveActive(shouldFocus ? id : null);
    this.bus.emit('panel:restored', { id });
    this.layoutChanged();
  }

  floatPanel(id: string, rect?: { x: number; y: number; width: number; height: number }, anchor?: FloatAnchor | null): void {
    const panel = this.s.panels[id];
    if (!panel) return;
    if (this.optionsFor(id).canDrag === false) return;
    const favourite = rect ?? this.registry.get(panel.component)?.defaultOptions?.favoritePosition ?? DEFAULT_RECT;
    this.detach(id);
    this.setPanel(id, { ...panel, state: 'floating' });
    this.addFloating(id, this.cascade(favourite), anchor ?? null);
    this.resolveActive(id);
    this.layoutChanged();
  }

  dockPanel(id: string, targetLeafId?: string): void {
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
    const cleaned = removePanelFromTree(this.s.gridRoot, panelId) ?? emptyRoot();
    this.set({
      floating: this.s.floating.filter(w => w.id !== panelId),
      minimized: this.s.minimized.filter(m => m.id !== panelId),
    });
    this.setPanel(panelId, { ...panel, state: 'docked' });
    this.set({ gridRoot: insertPanelInLeaf(cleaned, targetLeafId, panelId, targetIndex), draggedPanelId: null });
    this.resolveActive(panelId);
    this.layoutChanged();
  }

  /**
   * Toggle a panel between filling the workspace and its previous size. A minimised panel is
   * restored first — rdd's equivalent silently did nothing (vdd D1).
   */
  maximizePanel(id: string): void {
    if (this.s.panels[id]?.state === 'minimized') this.restorePanel(id);
    const panel = this.s.panels[id];
    if (!panel) return;
    if (panel.state === 'docked') this.floatPanel(id);
    this.set({ floating: this.s.floating.map(w => (w.id === id ? { ...w, maximized: !w.maximized } : w)) });
    this.resolveActive(id);
    this.layoutChanged();
  }

  focusPanel(id: string): void {
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

  setDirection(dir: 'ltr' | 'rtl'): void {
    if (this.s.dir === dir) return;
    this.set({ dir, isRtl: dir === 'rtl' });
  }

  /** @internal drives drag visuals */
  setDraggedPanelId(id: string | null): void {
    this.set({ draggedPanelId: id });
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
    const raw = this.s;
    const excluded: string[] = [];
    const included: Record<string, PanelInfo> = {};
    // A registered provider is pulled fresh on every save: serialisability can change over a
    // panel's lifetime, so it is never cached from open time for provider-backed panels.
    for (const [id, info] of Object.entries(raw.panels)) {
      const provider = this.stateProviders.get(id);
      const dynamic = provider?.();
      const hasDynamic = provider !== undefined && dynamic !== undefined;
      const ok = hasDynamic ? isSerializable(dynamic) : info.serializable;
      if (ok) included[id] = hasDynamic ? { ...info, props: dynamic as Record<string, unknown>, serializable: true } : info;
      else excluded.push(id);
    }
    // Excluded panels are pruned from the snapshot's tree/floating/minimized too, so a restore
    // never references a panel it has no data to recreate. The live state is untouched.
    let gridRoot: LayoutNode = raw.gridRoot;
    let floating = raw.floating;
    let minimized = raw.minimized;
    for (const id of excluded) {
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
      minimized,
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
      parsed = result;
    } catch {
      if (typeof ngDevMode === 'undefined' || ngDevMode) this.warn('loadLayout received invalid JSON; the current layout is unchanged.');
      return false;
    }
    const previous = this.s.activePanelId;
    this.set({
      gridRoot: parsed.gridRoot,
      floating: parsed.floating,
      minimized: parsed.minimized,
      panels: parsed.panels,
      draggedPanelId: null,
      activePanelId: parsed.activePanelId,
    });
    this.maxZ = Math.max(this.zIndexBase, ...parsed.floating.map(w => w.z), 0);
    if (previous !== parsed.activePanelId) this.bus.emit('panel:activated', { id: parsed.activePanelId, previous });
    this.layoutChanged();
    return true;
  }

  // ── events ─────────────────────────────────────────────────────────────────

  publish<K extends keyof (TEvents & BuiltInEvents) & string>(event: K, data: (TEvents & BuiltInEvents)[K]): void {
    this.bus.publish(event, data);
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
    this.menu.set({ ...menuPosition(options), items: options.items });
  }

  /** Dismiss the open menu, if any. */
  closeContextMenu(): void {
    this.menu.set(null);
  }

  // ── i18n ───────────────────────────────────────────────────────────────────

  /** Resolve a label through the configured formatter. */
  format(label: Label | undefined): string {
    if (label === undefined || label === null) return '';
    if (typeof label === 'string') return label;
    if (this.config.formatMessage) return this.config.formatMessage(label);
    let text = label.defaultMessage ?? label.id;
    for (const [k, v] of Object.entries(label.values ?? {})) text = text.replace(`{${k}}`, String(v));
    return text;
  }

  /** Drop every listener and guard. Called automatically when a provided workspace's injector is destroyed. */
  dispose(): void {
    this.bus.clear();
    this.overlays.dispose();
    this.closeGuards.clear();
    this.stateProviders.clear();
    this.panelMenus.clear();
    this.menu.set(null);
  }
}

/**
 * Create a workspace outside dependency injection — at module scope, in a test, or before
 * `bootstrapApplication`. It is live immediately: `openPanel()` works with nothing rendered.
 * Hand it to the app with `provideDockableDesktop(workspace)`.
 */
export function createWorkspace<TEvents extends Record<string, unknown> = Record<string, unknown>>(
  config: WorkspaceConfig = {},
): Workspace<TEvents> {
  return new Workspace<TEvents>(config);
}
