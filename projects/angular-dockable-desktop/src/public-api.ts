/*
 * Public API surface of angular-dockable-desktop.
 *
 * Every export is mirrored in /api-surface.json; the standing gate fails if the two disagree,
 * so the public surface cannot grow or shrink by accident.
 */

export { VERSION } from './lib/version';

// ─── The workspace ───────────────────────────────────────────────────────────
export { Workspace, createWorkspace } from './lib/workspace/workspace';
export type {
  WorkspaceConfig,
  WorkspaceState,
  PanelDefinition,
  OpenPanelOptions,
  HostClasses,
} from './lib/workspace/workspace';
export { provideDockableDesktop, injectWorkspace } from './lib/workspace/provide';
export type { BuiltInEvents } from './lib/core/event-bus';

// ─── Components ──────────────────────────────────────────────────────────────
export { NddDesktop } from './lib/desktop/desktop';
export type { TaskbarVisibility } from './lib/desktop/taskbar';

// ─── The panel's view of itself ──────────────────────────────────────────────
export { injectPanel } from './lib/panel/panel-ref';
export type { PanelRef } from './lib/panel/panel-ref';
export { injectColorScheme } from './lib/core/color-scheme';
export type { ColorScheme } from './lib/core/color-scheme';

// ─── Panel registry ──────────────────────────────────────────────────────────
export { PanelRegistry } from './lib/core/registry';
export type { PanelRegistryEntry, PanelDefaultOptions, PanelLoader } from './lib/core/registry';

// ─── Icons ───────────────────────────────────────────────────────────────────
export type { NddIcon } from './lib/core/icon';

// ─── Drag and resize primitives ──────────────────────────────────────────────
// Public so an application can build its own resizable UI inside a panel with exactly the
// mechanics the library uses for its own windows.
export { startPointerDrag, computeResizedRect } from './lib/core/drag-resize';
export type { PointerDragConfig, ResizeDir, ResizeRect, ResizeConstraints } from './lib/core/drag-resize';
export { clampFloatingRect } from './lib/core/anchor-geometry';
export type { FloatingRect } from './lib/core/anchor-geometry';

// ─── Serialisability ─────────────────────────────────────────────────────────
export { isSerializable } from './lib/core/serializable';

// ─── Messages and i18n ───────────────────────────────────────────────────────
export { defaultMessages, formatLabel } from './lib/core/messages';
export type { MessageKey } from './lib/core/messages';

// ─── Context menus ───────────────────────────────────────────────────────────
export { NddContextMenu, NddContextMenuTemplate } from './lib/context-menu/context-menu';
export type { NddContextMenuContext } from './lib/context-menu/context-menu';
export { injectContextMenu, injectPanelContextMenu, NddContextMenuTrigger } from './lib/context-menu/inject-context-menu';
export type {
  ContextMenuItem,
  ContextMenuSimpleItem,
  ContextMenuSeparator,
  ContextMenuSubMenu,
  ContextMenuCheckbox,
  ShowContextMenuOptions,
} from './lib/core/context-menu';

// ─── Sidebar and toolbar ─────────────────────────────────────────────────────
export {
  NddSidebar,
  NddSecondarySidebar,
  NddSidebarTabTemplate,
  NddSidebarHeaderTemplate,
  injectSidebar,
  injectSidebarTab,
} from './lib/sidebar/sidebar';
export type { NddSidebarTemplateContext, SidebarPosition } from './lib/sidebar/sidebar';
export { NddToolbar, injectToolbar } from './lib/toolbar/toolbar';
export type { ToolbarPosition } from './lib/toolbar/toolbar';

// ─── Toolbar and sidebar data shapes ─────────────────────────────────────────
export type {
  ToolbarItem,
  ToolbarActionItem,
  ToolbarRadioItem,
  ToolbarToggleItem,
  ToolbarGroupItem,
  ToolbarGroupSubItem,
  ToolbarGroupEntry,
  ToolbarSeparator,
} from './lib/core/toolbar-types';
export type { ToolbarState } from './lib/core/toolbar-state';
export type {
  SidebarTab,
  SidebarActionButton,
  SidebarCustomEntry,
  SidebarRailEntry,
  SidebarContext,
  SidebarTabContext,
} from './lib/core/sidebar-types';

// ─── Panel overlay: toolbars and floating widgets ────────────────────────────
export { NddPanelOverlay, NddPanelToolbar, injectFloatingWidgets } from './lib/panel-overlay/panel-overlay';
export type { FloatingWidgetsApi } from './lib/panel-overlay/panel-overlay';
export { NddFloatingWidget } from './lib/panel-overlay/floating-widget';
export type { ManagedWidget } from './lib/panel-overlay/overlay-store';
export {
  NddToolbarButton,
  NddToolbarToggle,
  NddToolbarSeparator,
  NddToolbarSpacer,
  NddToolbarItem,
  NddToolbarCenter,
} from './lib/panel-overlay/toolbar-controls';
export { NddToolbarSearch } from './lib/panel-overlay/toolbar-search';
export type { SearchResult } from './lib/panel-overlay/toolbar-search';
export type { ToolbarVariant, ButtonVariant, ToolbarInsets } from './lib/core/panel-overlay';

// ─── Side panels, modals, confirm, toasts ────────────────────────────────────
export { NddModals, NddSidePanels, injectModals, injectSidePanels, injectModalRef } from './lib/overlays/modals';
export type { NddModalRef, NddModalsApi, NddSidePanelsApi } from './lib/overlays/modals';
export { NddConfirm } from './lib/overlays/confirm';
export { NddToasts } from './lib/toast/toasts';
export { toast, resetToasts, NddToaster } from './lib/toast/toast';
export type {
  ToastFunction,
  ToastOptions,
  ResolvedToastOptions,
  ToastType,
  ToastPosition,
  ToastAdapter,
  ToastRecord,
  ToastPromiseMessages,
} from './lib/toast/toast';

// ─── Side panels and modals (state) ──────────────────────────────────────────
export type {
  Overlays,
  OverlayInstance,
  OverlayKind,
  OverlayState,
  SidePanelOptions,
  ModalOptions,
  ConfirmDiscard,
} from './lib/core/overlays';

// ─── Panel contributions ─────────────────────────────────────────────────────
export { sectionToTab, mergeToolbarItems, mergeSidebarTabs } from './lib/core/contributions';
export {
  injectPanelContribution,
  injectActiveContribution,
  injectMergedToolbarItems,
  injectMergedSidebarTabs,
} from './lib/contributions/inject-contributions';
export type { PanelContribution, PanelSidebarSection, Contributions } from './lib/core/contributions';

// ─── Inner-widget placement ──────────────────────────────────────────────────
export type { Stretch, PanelFloatPlacement } from './lib/core/stretch';

// ─── Domain types ────────────────────────────────────────────────────────────
export type {
  AlertType,
  ContainerType,
  DirtyStateOptions,
  DropPosition,
  DropTarget,
  FloatAnchor,
  FloatingWindow,
  Label,
  LayoutGridNode,
  LayoutLeafNode,
  LayoutNode,
  MessageDescriptor,
  MessageFormatter,
  PanelInfo,
  PanelState,
  SerializedLayout,
  SplitDirection,
  SplitOrientation,
} from './lib/core/types';
