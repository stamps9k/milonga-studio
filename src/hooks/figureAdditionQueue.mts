import type { Figure } from "../libs/dance/step.mts";

interface Callbacks {
  load: (figureId: string) => Promise<Figure>;
  append: (figure: Figure) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

/** One queue per editor. Serialize the whole fetch-and-append operation so
 * placement follows click order rather than network response order. Pending
 * includes queued requests, keeping save/export disabled until the queue drains.
 * An unsuccessful addition is reported and consumed so later clicks still run.
 * This coordinator has no React or placement logic, allowing delayed/rejected
 * requests to be tested without timers or a browser.
 */
export function createFigureAdditionQueue({
  load,
  append,
  setLoading,
  setError,
}: Callbacks): (figureId: string) => Promise<void> {
  let tail = Promise.resolve();
  let pending = 0;

  return (figureId) => {
    if (pending++ === 0) setLoading(true);
    setError(null);
    const addition = tail.then(async () => {
      try {
        append(await load(figureId));
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (--pending === 0) setLoading(false);
      }
    });
    tail = addition;
    return addition;
  };
}
