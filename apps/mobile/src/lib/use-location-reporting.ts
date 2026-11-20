import { useEffect } from 'react';
import { getCurrentPoint } from './location';
import { api } from './session';

/**
 * While `active`, tells the API where the helper is: once at the start and
 * then every `seconds`. It runs only while the screen using it is open; the
 * app does not track location in the background.
 */
export function useLocationReporting(active: boolean, seconds: number) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const report = () =>
      void getCurrentPoint().then((point) => (point ? api.reportLocation(point).catch(() => undefined) : undefined));
    report();
    const timer = setInterval(report, seconds * 1000);
    return () => clearInterval(timer);
  }, [active, seconds]);
}
