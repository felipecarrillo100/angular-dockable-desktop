/**
 * Dependency injection for the workspace.
 *
 *   bootstrapApplication(App, { providers: [provideDockableDesktop({ panels: { … } })] });
 *   // anywhere:
 *   readonly workspace = inject(Workspace);
 *
 * `Workspace` is its own DI token, as a class-based service is. `provideDockableDesktop()`
 * returns plain providers rather than `EnvironmentProviders`, so it also works in a
 * component's `providers` — which is how two independent workspaces live on one page.
 */
import { DestroyRef, inject } from '@angular/core';
import type { Provider } from '@angular/core';
import { Workspace, createWorkspace } from './workspace';
import type { WorkspaceConfig } from './workspace';

/**
 * Provide a workspace to an application (or a component subtree).
 *
 * - Pass a **config** and a workspace is created for this injector, and disposed with it.
 * - Pass a **`Workspace`** made by `createWorkspace()` — e.g. at module scope, so services can
 *   drive it before bootstrap — and that instance is provided as-is. You own its lifetime.
 */
export function provideDockableDesktop(configOrWorkspace: WorkspaceConfig | Workspace<never> = {}): Provider[] {
  if (configOrWorkspace instanceof Workspace) return [{ provide: Workspace, useValue: configOrWorkspace }];
  return [
    {
      provide: Workspace,
      useFactory: () => {
        const workspace = createWorkspace(configOrWorkspace);
        inject(DestroyRef).onDestroy(() => workspace.dispose());
        return workspace;
      },
    },
  ];
}

/**
 * `inject(Workspace)`, with a directed error instead of `NullInjectorError` when no workspace
 * was provided. Must be called in an injection context, like `inject()`.
 */
export function injectWorkspace<TEvents extends Record<string, unknown> = Record<string, unknown>>(): Workspace<TEvents> {
  const workspace = inject(Workspace, { optional: true });
  if (!workspace) {
    throw new Error(
      '[angular-dockable-desktop] No Workspace is provided here. Add provideDockableDesktop({ panels: { … } }) ' +
        'to your application providers (bootstrapApplication / ApplicationConfig), or to a parent component\'s providers.',
    );
  }
  return workspace as Workspace<TEvents>;
}
