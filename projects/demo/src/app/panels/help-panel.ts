import { ChangeDetectionStrategy, Component } from '@angular/core';

/** What the user can do with the workspace, from the library's own point of view. */
@Component({
  selector: 'dd-help-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel">
      <div class="dd-section">
        <h5>With a pointer</h5>
        <ul style="margin: 0; padding-inline-start: 1.1rem; line-height: 1.7">
          <li>Drag a <strong>tab</strong> onto another group's edge to split it, or its centre to join it.</li>
          <li>Drag to a <strong>workspace edge</strong> for a full-width row, or a corner to float anchored.</li>
          <li>Drag the <strong>divider</strong> between groups to resize; drag a window's edge or corner.</li>
          <li><strong>Double-click</strong> a floating window's title bar to maximise it.</li>
          <li><strong>Right-click</strong> a tab, a title bar or a taskbar icon for its menu.</li>
          <li><strong>Hover</strong> a minimised panel in the taskbar for a live thumbnail — not a screenshot.</li>
        </ul>
      </div>

      <div class="dd-section">
        <h5>With a finger</h5>
        <ul style="margin: 0; padding-inline-start: 1.1rem; line-height: 1.7">
          <li><strong>Long-press</strong> a tab or title bar for 300ms to start a drag.</li>
          <li>Moving more than 8px before that cancels the press, so a scroll stays a scroll.</li>
          <li><strong>Tap</strong> a minimised icon for its preview; tap the preview to restore.</li>
        </ul>
      </div>

      <div class="dd-section">
        <h5>With a keyboard</h5>
        <ul style="margin: 0; padding-inline-start: 1.1rem; line-height: 1.7">
          <li><strong>Delete</strong> on a focused tab closes it; <strong>Shift+F10</strong> opens its menu.</li>
          <li>Menus follow the ARIA menu pattern: arrows, Home, End, Enter and Escape.</li>
        </ul>
      </div>

      <p class="dd-note">
        Everything above is also available programmatically — the Control Center panel drives the
        same API the mouse does.
      </p>
    </div>
  `,
})
export class HelpPanel {}
