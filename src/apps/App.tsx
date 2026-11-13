import { useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Toolbar, { type ViewMode } from "../components/Toolbar";
import StepLibrary from "../components/StepLibrary";
import Canvas2D from "../components/Canvas2D";
import Canvas3D from "../components/Canvas3D";
import Sequence from "../components/Sequence";
import Timeline from "../components/Timeline";
import ActiveStep from "../components/ActiveStep";
import { useSequenceBuilder } from "../hooks/useSequenceBuilder.mts";
import { usePlayback } from "../hooks/usePlayback.mts";
import { useSequenceExport } from "../hooks/useSequenceExport.mts";
import { sequenceDurationBeats } from "../libs/dance/fold.mts";

const App = () => {
  const { entries, activeFigureId, addFigure, removeFigure, loading, error } =
    useSequenceBuilder();
  const totalBeats = sequenceDurationBeats(entries);
  const { beat, playing, toggle, seek, stepBy } = usePlayback(totalBeats);
  const { shareStatus, share, exportSequence } = useSequenceExport(entries);
  const [view, setView] = useState<ViewMode>("2d");

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="*"
          element={
            <div className="app">
              <Toolbar
                view={view}
                onViewChange={setView}
                onShare={share}
                onExport={exportSequence}
                shareStatus={shareStatus}
                canExport={entries.length > 0}
              />
              <div className="container-fluid px-4 py-4">
                <div className="row g-4">
                  <StepLibrary
                    onSelectFigure={addFigure}
                    sequenceEnd={
                      entries.length > 0
                        ? entries[entries.length - 1].resolvedEndPose
                        : null
                    }
                  />
                  <div className="col-9 d-flex flex-column gap-4">
                    <div className="card overflow-hidden">
                      {view === "2d" ? (
                        <Canvas2D entries={entries} currentBeat={beat} />
                      ) : (
                        <Canvas3D />
                      )}
                      <ActiveStep entries={entries} currentBeat={beat} />
                    </div>
                    <Sequence
                      entries={entries}
                      activeFigureId={activeFigureId}
                      loading={loading}
                      error={error}
                      onRemove={removeFigure}
                    />
                    <Timeline
                      beat={beat}
                      totalBeats={totalBeats}
                      playing={playing}
                      onToggle={toggle}
                      onSeek={seek}
                      onStepBy={stepBy}
                    />
                  </div>
                </div>
              </div>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
