import { type ReactElement } from "react";
import { RecordingOverlay, WindowTitleBar } from "./app-helpers";
import { ReleaseView } from "./ReleaseView";
import { DeveloperView } from "./DeveloperView";

export function AppView(props: Record<string, any>): ReactElement {
  const { isDeveloperBuild, isOverlay, overlayState, state } = props;
  if (isOverlay) {
    return <RecordingOverlay state={overlayState} />;
  }

  if (!state.settings) {
    return (
      <main className="app-shell">
        <WindowTitleBar title="VoxType" />
        <header className="app-header">
          <div>
            <div className="app-brand">VoxType</div>
            <p>Local dictation for Windows</p>
          </div>
        </header>
        <section className="dictation-home">
          <div className="dictation-status">
            <span className="status-dot" />
            <div>
              <strong>Loading</strong>
              <span>Preparing local dictation</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!state.settings.developerModeEnabled || !isDeveloperBuild) {
    return <ReleaseView {...props} />;
  }

  return <DeveloperView {...props} />;
}
