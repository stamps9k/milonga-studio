import { useEffect, useRef, useState } from "react";

export interface Confirmation {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

/** Keep document operations suspended until a real dialog choice is made.
 * Unmounting cancels any pending choice, so abandoning a discard/delete
 * dialog cannot leave its operation waiting indefinitely. */
export function useConfirmation() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );

  const ask = (request: Confirmation): Promise<boolean> => {
    if (resolver.current) return Promise.resolve(false);
    setConfirmation(request);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  };
  const answer = (accepted: boolean) => {
    resolver.current?.(accepted);
    resolver.current = null;
    setConfirmation(null);
  };
  return { confirmation, ask, answer };
}
