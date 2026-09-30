// Answers the background script with the current playback position (whole seconds)
// of the video playing in this frame, or null when nothing has started playing.
browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'getTimestamp') return undefined;
  const video = [...document.querySelectorAll('video')].find((v) => v.currentTime > 0);
  return Promise.resolve(video ? Math.floor(video.currentTime) : null);
});
