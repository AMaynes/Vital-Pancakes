/**
 * Same-document captured-video fallback. Subtitles can remain visible in
 * fullscreen because the video and overlay share one document.
 */

export class CaptionMirror {
  constructor(wrapper, video, caption) {
    this.wrapper = wrapper;
    this.video = video;
    this.caption = caption;
    this.stream = null;
  }

  async connect() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Mirror Mode is unavailable in this browser.");
    }
    this.disconnect();
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    });
    if (!this.stream.getVideoTracks().length) {
      this.disconnect();
      throw new Error("The selected source did not provide a video track.");
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.wrapper.hidden = false;
    await this.video.play().catch(() => {});
    this.stream.getVideoTracks()[0].addEventListener("ended", () => this.disconnect(), { once: true });
    return this.stream;
  }

  async enterFullscreen() {
    if (!this.wrapper?.requestFullscreen) {
      throw new Error("Fullscreen Mirror Mode is unavailable in this browser.");
    }
    await this.wrapper.requestFullscreen();
  }

  setMuted(muted) {
    this.video.muted = Boolean(muted);
  }

  updateCaption(sourceText, translatedText, {
    bilingual = false,
    visible = false,
  } = {}) {
    const lines = bilingual ? [sourceText, translatedText] : [translatedText];
    this.caption.textContent = lines.filter(Boolean).join("\n");
    this.caption.hidden = !visible;
  }

  disconnect() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (this.wrapper) this.wrapper.hidden = true;
  }
}
