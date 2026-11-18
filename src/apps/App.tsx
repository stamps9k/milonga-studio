import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import DanceControls from "../components/DanceControls";
import type { Dance } from "../libs/dance/dance.mts";
import { emptyDance } from "../libs/dance/persistence.mts";
import { danceFromURL } from "../libs/browser/danceLink.mts";
import { entriesToSequence } from "../libs/dance/serialize.mts";
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
import { type ClickDivision, metronomeClicks } from "../libs/dance/tempo.mts";

interface StudioProps {
  initialDance: Dance | null;
  localId?: string;
  onOpen: (dance: Dance | null, localId?: string) => void;
}

const Studio = ({ initialDance, localId, onOpen }: StudioProps) => {
  const [original, setOriginal] = useState(() => initialDance ?? emptyDance());
  const [name, setName] = useState(original.name);
  const [notes, setNotes] = useState(original.notes ?? "");
  const { entries, activeFigureId, addFigure, removeFigure, loading, error } =
    useSequenceBuilder(original.sequence.entries);
  const totalBeats = sequenceDurationBeats(entries);
  const [clickDivision, setClickDivision] = useState<ClickDivision>("beat");
  const tempo = useTempo(entries, clickDivision, initialDance?.tempo);
  const { beat, playing, toggle, seek, stepBy } = usePlayback(
    totalBeats,
    tempo.bpm,
  );
  const [metronomeOn, setMetronomeOn] = useState(false);
  const clicks = useMemo(
    () => metronomeClicks(entries, clickDivision),
    [entries, clickDivision],
  );
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
  const dance = useMemo<Dance>(
    () => ({
      ...original,
      name,
      notes,
      tempo: tempo.bpm,
      sequence: {
        ...entriesToSequence(entries),
        id: original.sequence.id,
        name,
      },
    }),
    [original, name, notes, tempo.bpm, entries],
  );
  const {
    shareStatus,
    share,
    exportSequence,
    exportError,
    clearFeedback: clearExportFeedback,
  } = useSequenceExport(dance);
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
              <Toolbar view={view} onViewChange={setView}>
                <DanceControls
                  dance={dance}
                  initialLocalId={localId}
                  building={loading}
                  onSaved={(saved) => {
                    setName(saved.name);
                    setNotes(saved.notes ?? "");
                    setOriginal((previous) => ({
                      ...previous,
                      id: saved.id,
                      createdAt: saved.createdAt,
                      updatedAt: saved.updatedAt,
                    }));
                  }}
                  onNameChange={setName}
                  onNotesChange={setNotes}
                  onOpen={onOpen}
                  onShare={share}
                  onExport={exportSequence}
                  shareStatus={shareStatus}
                  exportError={exportError}
                  onDismissExportFeedback={clearExportFeedback}
                  canExport={entries.length > 0 && !loading}
                />
              </Toolbar>
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
                  <div
                    className="col-9 d-flex flex-column gap-4"
                    style={{ minWidth: 0 }}>
                    <div className="card overflow-hidden">
                      {view === "2d" ? (
                        <Canvas2D
                          entries={entries}
                          currentBeat={beat}
                          shown={shownPartners}
                          onToggleShown={toggleShownPartner}
                        />
                      ) : (
                        <Canvas3D
                          entries={entries}
                          currentBeat={beat}
                          shown={shownPartners}
                          onToggleShown={toggleShownPartner}
                        />
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
                      clickDivision={clickDivision}
                      onClickDivisionChange={setClickDivision}
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

/** A fresh editor per opened dance resets playback, tempo and pending figure
 * requests together. Startup links are decoded before mounting it; invalid
 * links show a recoverable error and never write to local storage. */
const App = () => {
  const [session, setSession] = useState<{
    key: number;
    dance: Dance | null;
    localId?: string;
  }>({ key: 0, dance: null });
  const [starting, setStarting] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void danceFromURL(window.location.href)
      .then((dance) => {
        if (!cancelled) setSession({ key: 0, dance });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLinkError(
            error instanceof Error
              ? error.message
              : "Couldn’t open this dance link.",
          );
      })
      .finally(() => {
        if (!cancelled) setStarting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const open = (dance: Dance | null, localId?: string) => {
    // Consume the preload parameter on navigation so reloading a later local
    // dance doesn't unexpectedly reopen the original shared snapshot.
    const url = new URL(window.location.href);
    url.searchParams.delete("dance");
    window.history.replaceState(null, "", url);
    setLinkError(null);
    setSession((previous) => ({ key: previous.key + 1, dance, localId }));
  };
  if (starting)
    return (
      <p className="p-4" role="status">
        Opening dance…
      </p>
    );
  return (
    <>
      {linkError && (
        <p role="alert" className="text-danger px-4 pt-3">
          {linkError} You can open a preset, local save or JSON file below.
        </p>
      )}
      <Studio
        key={session.key}
        initialDance={session.dance}
        localId={session.localId}
        onOpen={open}
      />
    </>
  );
};
export default App;
