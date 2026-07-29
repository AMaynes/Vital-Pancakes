/**
 * Returns the user-facing state for the remotely loaded, browser-local
 * conversion surface.
 *
 * @param {{online: boolean, loaded: boolean, timedOut: boolean}} state
 * @returns {{label: string, tone: "loading" | "ready" | "warning"}}
 */
export function getConverterStatus({ online, loaded, timedOut }) {
  if (loaded) {
    return {
      label: "Ready · files stay in your browser",
      tone: "ready",
    };
  }

  if (!online) {
    return {
      label: "Offline · connect to load conversion engines",
      tone: "warning",
    };
  }

  if (timedOut) {
    return {
      label: "Still loading · retry or open full screen",
      tone: "warning",
    };
  }

  return {
    label: "Loading conversion engines",
    tone: "loading",
  };
}
