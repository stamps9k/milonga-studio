import { useMemo, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Toolbar, { type ViewMode } from "../components/Toolbar";
import StepLibrary from "../components/StepLibrary";
import Canvas2D from "../components/Canvas2D";
import Canvas3D from "../components/Canvas3D";
import Sequence from "../components/Sequence";
import Timeline from "../components/Timeline";
import ActiveStep from "../components/ActiveStep";
import TempoControls from "../components/TempoControls";
import { useSequenceBuilder } from "../hooks/useSequenceBuilder.mts";
import { usePlayback } from "../hooks/usePlayback.mts";
import { useTempo } from "../hooks/useTempo.mts";
import { useMetronome } from "../hooks/useMetronome.mts";
import { useSequenceExport } from "../hooks/useSequenceExport.mts";
import type { Partner } from "../libs/dance/step.mts";
import {
  sequenceDurationBeats,
  sequenceEntryIndexAtBeat,
  sequenceEntrySpans,
} from "../libs/dance/fold.mts";
import { metronomeClicks } from "../libs/dance/tempo.mts";

const App = () => {
  const { entries, activeFigureId, addFigure, removeFigure, loading, error } =
    useSequenceBuilder();
  const totalBeats = sequenceDurationBeats(entries);
  const tempo = useTempo(entries);
  const { beat, playing, toggle, seek, stepBy } = usePlayback(
    totalBeats,
    tempo.bpm,
  );
  const [metronomeOn, setMetronomeOn] = useState(false);
  const clicks = useMemo(() => metronomeClicks(entries), [entries]);
  const { prime: primeMetronome } = useMetronome({
    enabled: metronomeOn,
    playing,
    beat,
    bpm: tempo.bpm,
    clicks,
  });
  // Audio can only start from a user gesture, so the play button and the
  // metronome switch both start it before doing their own thing.
  const togglePlayback = () => {
    if (metronomeOn) primeMetronome();
    toggle();
  };
  const toggleMetronome = () => {
    if (!metronomeOn) primeMetronome();
    setMetronomeOn((on) => !on);
  };
  const timelineSegments = useMemo(
    () =>
      sequenceEntrySpans(entries).map((span, index) => ({
        ...span,
        label: entries[index].figure.name,
      })),
    [entries],
  );
  const currentSegment = sequenceEntryIndexAtBeat(entries, beat);
  const { shareStatus, share, exportSequence } = useSequenceExport(entries);
  const [view, setView] = useState<ViewMode>("2d");
  // Which dancers the 2D canvas draws (see PartnerToggle). Kept here
  // rather than in Canvas2D so it survives switching to 3D and back.
  const [shownPartners, setShownPartners] = useState<Record<Partner, boolean>>({
    lead: true,
    follow: true,
  });
  const toggleShownPartner = (partner: Partner) =>
    setShownPartners((shown) => ({ ...shown, [partner]: !shown[partner] }));

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
                        <Canvas2D
                          entries={entries}
                          currentBeat={beat}
                          shown={shownPartners}
                          onToggleShown={toggleShownPartner}
                        />
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
                      segments={timelineSegments}
                      currentSegment={currentSegment}
                      totalBeats={totalBeats}
                      playing={playing}
                      onToggle={togglePlayback}
                      onSeek={seek}
                      onStepBy={stepBy}
                    />
                    <TempoControls
                      bpm={tempo.bpm}
                      defaultBpm={tempo.defaultBpm}
                      adjusted={tempo.adjusted}
                      onBpmChange={tempo.setBpm}
                      onTap={tempo.tap}
                      onReset={tempo.reset}
                      metronomeOn={metronomeOn}
                      onMetronomeToggle={toggleMetronome}
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
