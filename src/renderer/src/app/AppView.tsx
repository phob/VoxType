import { type ReactElement } from "react";
import { RecordingOverlay, WindowTitleBar } from "./app-helpers";
import { ReleaseView } from "./ReleaseView";
import { DeveloperView } from "./DeveloperView";
import { type AppViewProps, type ReadyAppViewProps } from "./app-types";

export function AppView(props: AppViewProps): ReactElement {
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

  const readyProps = props as ReadyAppViewProps;

  if (!state.settings.developerModeEnabled || !isDeveloperBuild) {
    return <ReleaseView {...readyProps} />;
  }

  return <DeveloperView {...readyProps} />;
}
