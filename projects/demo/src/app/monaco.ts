import { DestroyRef, afterNextRender, effect, inject, signal } from '@angular/core';
import type { ElementRef, Signal, WritableSignal } from '@angular/core';
import * as monaco from 'monaco-editor';

/**
 * Monaco in an Angular component. Monaco takes a plain element and gives back a disposable, so
 * no wrapper library is needed — create it once the element exists, dispose it with the
 * component.
 *
 * The demo's editors live in dockable panels, which is the interesting part: a panel is moved
 * between hosts without ever being re-created, so the editor keeps its model, undo history,
 * cursor and folded regions through every dock, float and minimise. It is only told its box
 * changed (`automaticLayout`).
 */
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    if (label === 'json') return new Worker(new URL('./workers/json.worker', import.meta.url), { type: 'module' });
    if (label === 'css' || label === 'scss' || label === 'less') return new Worker(new URL('./workers/css.worker', import.meta.url), { type: 'module' });
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new Worker(new URL('./workers/html.worker', import.meta.url), { type: 'module' });
    if (label === 'typescript' || label === 'javascript') return new Worker(new URL('./workers/ts.worker', import.meta.url), { type: 'module' });
    return new Worker(new URL('./workers/editor.worker', import.meta.url), { type: 'module' });
  },
};

export interface MonacoOptions {
  language?: string;
  /** `vs-dark` or `vs`; the demo follows the workspace's colour scheme. */
  theme?: Signal<string>;
  readOnly?: boolean;
}

/** Call in an injection context. `value` is two-way: typing writes it, writing it edits undoably. */
export function monacoEditor(host: Signal<ElementRef<HTMLElement> | undefined>, value: WritableSignal<string>, options: MonacoOptions = {}): Signal<monaco.editor.IStandaloneCodeEditor | null> {
  const editor = signal<monaco.editor.IStandaloneCodeEditor | null>(null);
  let applying = false;

  afterNextRender(() => {
    const element = host()?.nativeElement;
    if (!element) return;
    const instance = monaco.editor.create(element, {
      value: value(),
      language: options.language ?? 'typescript',
      theme: options.theme?.() ?? 'vs-dark',
      readOnly: options.readOnly ?? false,
      minimap: { enabled: false },
      automaticLayout: true, // the panel's box changes often
      fontSize: 12,
      scrollBeyondLastLine: false,
      tabSize: 2,
      renderWhitespace: 'selection',
    });
    // `applying` guards the round trip: writing the model from the signal would otherwise look
    // like the user typing, and echo back.
    instance.onDidChangeModelContent(() => {
      if (!applying) value.set(instance.getValue());
    });
    editor.set(instance);
  });

  effect(() => {
    const next = value();
    const instance = editor();
    if (!instance || instance.getValue() === next) return;
    applying = true;
    // An edit rather than setValue, so an external change is undoable instead of resetting the
    // history the panel has been preserving.
    const model = instance.getModel();
    if (model) instance.executeEdits('external', [{ range: model.getFullModelRange(), text: next }]);
    applying = false;
  });

  if (options.theme) {
    const theme = options.theme;
    effect(() => monaco.editor.setTheme(theme()));
  }

  inject(DestroyRef).onDestroy(() => editor()?.dispose());
  return editor.asReadonly();
}
