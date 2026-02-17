const { core, event, http, console } = iina;

const REPORT_INTERVAL = 10000; // 10 seconds

let session = null;
let timer = null;
let lastPosition = 0;

function getParam(url, name) {
  const re = new RegExp("[?&]" + name + "=([^&]+)");
  const m = url.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

function report(state) {
  if (!session) return;

  const position = core.status.position || 0;
  if (position > 0) lastPosition = position;

  const durationSec = core.status.duration || 0;
  const durationMs = durationSec > 0 ? Math.round(durationSec * 1000) : session.durationMs;

  http.post(session.callback, {
    headers: { "Content-Type": "application/json" },
    data: {
      rating_key: session.ratingKey,
      time_ms: Math.round(lastPosition * 1000),
      duration_ms: durationMs,
      state: state,
    },
  }).catch(function () {});
}

function stopTracking() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (session) {
    report("stopped");
    session = null;
    lastPosition = 0;
  }
}

function startTracking(ratingKey, durationMs, callback) {
  stopTracking();

  session = {
    ratingKey: ratingKey,
    durationMs: durationMs,
    callback: callback,
  };

  report("playing");

  timer = setInterval(function () {
    var state = core.status.paused ? "paused" : "playing";
    report(state);
  }, REPORT_INTERVAL);
}

event.on("iina.file-loaded", function (url) {
  var ratingKey = getParam(url, "X-Pli-Rating-Key");
  var callback = getParam(url, "X-Pli-Callback");
  if (!ratingKey || !callback) return;

  var durationParam = getParam(url, "X-Pli-Duration");
  var durationMs = durationParam ? parseInt(durationParam, 10) : 0;

  startTracking(ratingKey, durationMs, callback);
});

event.on("mpv.pause.changed", function () {
  if (!session) return;
  var state = core.status.paused ? "paused" : "playing";
  report(state);
});

event.on("mpv.end-file", function () {
  stopTracking();
});

event.on("iina.window-will-close", function () {
  stopTracking();
});
