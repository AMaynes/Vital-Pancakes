/**
 * Registers the offline shell and refreshes an already-controlled Workspace
 * once when a newer service worker takes over.
 *
 * @param {{
 *   serviceWorker?: ServiceWorkerContainer,
 *   locationRef?: Location,
 * }} options Browser dependencies.
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerOfflineShell({
  serviceWorker = globalThis.navigator?.serviceWorker,
  locationRef = globalThis.location,
} = {}) {
  if (!serviceWorker?.register) return null;

  const hadController = Boolean(serviceWorker.controller);
  let reloading = false;
  serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    locationRef?.reload();
  });

  const registration = await serviceWorker.register("./sw.js", {
    updateViaCache: "none",
  });
  await registration.update?.();
  return registration;
}
