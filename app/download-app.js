/**
 * Overview & Purpose
 * Connects the Download App page to the browser's supported PWA install flow.
 *
 * Architectural Relationships
 * Called by: download-app.html.
 * Calls: beforeinstallprompt, the service worker, and the install guide.
 *
 * External Resources
 * manifest.webmanifest and sw.js.
 *
 * Notes
 * iOS does not expose beforeinstallprompt, so its buttons guide the visitor to
 * Safari's Add to Home Screen instructions instead of claiming an install ran.
 */

const installButtons = [
  document.querySelector("#install-app-button"),
  document.querySelector("#install-app-button-secondary"),
].filter(Boolean);
const installStatus = document.querySelector("#install-status");
const installGuide = document.querySelector("#install-guide");

let deferredInstallPrompt = null;

/**
 * Opens the native prompt when available or reveals manual phone instructions.
 */
async function requestInstallation() {
  if (!deferredInstallPrompt) {
    installStatus.textContent = "Use your browser menu—or Safari’s Share menu—then choose Install app or Add to Home Screen.";
    installGuide.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  installStatus.textContent = choice.outcome === "accepted"
    ? "Installation accepted. The app will appear with your other apps."
    : "Installation was left unchanged. You can install whenever you are ready.";
  deferredInstallPrompt = null;
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installStatus.textContent = "This browser is ready to install the app.";
});

window.addEventListener("appinstalled", () => {
  installStatus.textContent = "Vital Pancakes is installed.";
  installButtons.forEach((button) => {
    button.textContent = "App installed";
    button.disabled = true;
  });
});

installButtons.forEach((button) => button.addEventListener("click", requestInstallation));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.error("Offline service worker registration failed.", error);
  });
}
