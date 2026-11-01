/* ==========================================================================
   M'uzie — spatial cassette deck
   HTML5 Audio + Web Audio API (PannerNode, BiquadFilter, AnalyserNode).
   No libraries, no network calls, everything stays on the device.
   ========================================================================== */

"use strict";

const AUDIO_EXTENSIONS = /\.(mp3|wav|wave|ogg|oga|m4a|aac|flac|opus|weba|webm)$/i;
const ROOM_WIDTH = 9; // metres, left <-> right
const ROOM_DEPTH = 7; // metres, back <-> front
const VOLUME_KEY = "muzie-volume";
const COPY_TITLE = "M'uzie — spatial cassette deck";

const state = {
  tracks: [],
  current: -1,
  playing: false,
  seeking: false,
  volume: 0.8,
  muted: false,
  speaker: { x: 0.78, y: 0.5 },
};

const dom = {
  audio: document.getElementById("audio"),

  uploadBtn: document.getElementById("uploadBtn"),
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),

  playlist: document.getElementById("playlist"),
  playlistEmpty: document.getElementById("playlistEmpty"),
  trackCount: document.getElementById("trackCount"),
  clearPlaylist: document.getElementById("clearPlaylist"),

  cassette: document.getElementById("cassette"),
  tapeTitle: document.getElementById("tapeTitle"),
  trackTitle: document.getElementById("trackTitle"),

  playBtn: document.getElementById("playBtn"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  progress: document.getElementById("progress"),
  timeCurrent: document.getElementById("timeCurrent"),
  timeTotal: document.getElementById("timeTotal"),
  volume: document.getElementById("volume"),
  volumeValue: document.getElementById("volumeValue"),
  muteBtn: document.getElementById("muteBtn"),

  room: document.getElementById("room"),
  canvas: document.getElementById("viz"),
  speaker: document.getElementById("speaker"),
  beam: document.getElementById("beam"),
  distance: document.getElementById("distance"),
  panLabel: document.getElementById("panLabel"),
  spatialNotice: document.getElementById("spatialNotice"),

  toast: document.getElementById("toast"),
};

let toastTimer = null;
let trackSeq = 0;

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function cleanName(filename) {
  const withoutExtension = filename.replace(/\.[^.]+$/, "").trim();
  return withoutExtension || filename;
}

function isAudioFile(file) {
  const type = (file.type || "").toLowerCase();
  return type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name || "");
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, 3200);
}

function readStoredVolume() {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 0.8;

    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8;
  } catch (error) {
    return 0.8;
  }
}

function storeVolume(value) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(value));
  } catch (error) {
    /* Storage can be blocked; the player still works. */
  }
}

/* --------------------------------------------------------------------------
   Web Audio engine
   -------------------------------------------------------------------------- */

const engine = {
  ctx: null,
  source: null,
  panner: null,
  filter: null,
  gain: null,
  analyser: null,
  ready: false,
  supported: true,

  init() {
    if (this.ctx) return true;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    if (!AudioCtx) {
      this.disable("Web Audio API не поддерживается — играет обычное стерео");
      return false;
    }

    try {
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(dom.audio);

      const panner = ctx.createPanner();
      try {
        panner.panningModel = "HRTF";
      } catch (error) {
        panner.panningModel = "equalpower";
      }
      panner.distanceModel = "inverse";
      panner.refDistance = 1.5;
      panner.maxDistance = 18;
      panner.rolloffFactor = 1.2;
      if (panner.positionY) panner.positionY.value = 0;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 19000;
      filter.Q.value = 0.7;

      const gain = ctx.createGain();
      gain.gain.value = state.muted ? 0 : state.volume;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;

      source.connect(panner);
      panner.connect(filter);
      filter.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);

      const listener = ctx.listener;
      if (listener.positionX) {
        listener.positionX.value = 0;
        listener.positionY.value = 0;
        listener.positionZ.value = 0;
        listener.forwardX.value = 0;
        listener.forwardY.value = 0;
        listener.forwardZ.value = -1;
        listener.upX.value = 0;
        listener.upY.value = 1;
        listener.upZ.value = 0;
      } else if (listener.setPosition) {
        listener.setPosition(0, 0, 0);
        listener.setOrientation(0, 0, -1, 0, 1, 0);
      }

      this.ctx = ctx;
      this.source = source;
      this.panner = panner;
      this.filter = filter;
      this.gain = gain;
      this.analyser = analyser;
      this.ready = true;

      // The audio element itself must stay at full volume: gain handles it.
      dom.audio.volume = 1;

      updateSpatial();
      return true;
    } catch (error) {
      this.disable("Не удалось запустить Web Audio — играет обычное стерео");
      return false;
    }
  },

  disable(message) {
    this.supported = false;
    this.ready = false;
    dom.spatialNotice.hidden = false;
    dom.spatialNotice.textContent = message;
    dom.room.classList.add("is-flat");
    dom.speaker.setAttribute("aria-disabled", "true");
    dom.audio.volume = state.muted ? 0 : state.volume;
  },

  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {
        showToast("Браузер заблокировал звук — нажмите Play ещё раз");
      });
    }
  },

  setVolume(value) {
    const level = clamp(value, 0, 1);

    if (this.ready && this.gain) {
      this.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.03);
    } else {
      dom.audio.volume = level;
    }
  },
};

/* --------------------------------------------------------------------------
   Spatial position
   -------------------------------------------------------------------------- */

function setPannerPosition(panner, x, y, z) {
  if (!panner) return;

  const now = engine.ctx ? engine.ctx.currentTime : 0;

  if (panner.positionX) {
    panner.positionX.setTargetAtTime(x, now, 0.06);
    panner.positionY.setTargetAtTime(y, now, 0.06);
    panner.positionZ.setTargetAtTime(z, now, 0.06);
  } else if (panner.setPosition) {
    panner.setPosition(x, y, z);
  }
}

function updateSpatial() {
  const x = (state.speaker.x - 0.5) * ROOM_WIDTH;
  const z = (state.speaker.y - 0.5) * ROOM_DEPTH;
  const distance = Math.hypot(x, z);

  if (engine.ready) {
    setPannerPosition(engine.panner, x, 0, z);

    // Distance makes the sound duller, like a speaker behind a wall.
    const falloff = Math.min(distance / 5.5, 1);
    const cutoff = 19000 * Math.pow(0.028, falloff);

    engine.filter.frequency.setTargetAtTime(
      clamp(cutoff, 500, 19000),
      engine.ctx.currentTime,
      0.07
    );
  }

  const pan = x < -0.7 ? "слева" : x > 0.7 ? "справа" : "по центру";

  dom.distance.textContent = `${distance.toFixed(1)} м`;
  dom.panLabel.textContent = pan;
  dom.speaker.setAttribute(
    "aria-valuetext",
    `Колонка ${pan}, дистанция ${distance.toFixed(1)} метра`
  );

  updateBeam();
}

function updateBeam() {
  const rect = dom.room.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const speakerX = rect.width * state.speaker.x;
  const speakerY = rect.height * state.speaker.y;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const dx = speakerX - centerX;
  const dy = speakerY - centerY;
  const angle = Math.atan2(dy, dx);

  dom.beam.style.width = `${Math.hypot(dx, dy)}px`;
  dom.beam.style.transform = `translateY(-50%) rotate(${angle}rad)`;
}

function applySpeakerPosition() {
  dom.speaker.style.left = `${state.speaker.x * 100}%`;
  dom.speaker.style.top = `${state.speaker.y * 100}%`;
  dom.speaker.setAttribute(
    "aria-valuenow",
    String(Math.round(state.speaker.x * 100))
  );
}

function initRoom() {
  applySpeakerPosition();
  updateSpatial();

  const room = dom.room;
  let dragging = false;
  let pointerId = null;

  const moveTo = (clientX, clientY) => {
    const rect = room.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    state.speaker.x = clamp((clientX - rect.left) / rect.width, 0.07, 0.93);
    state.speaker.y = clamp((clientY - rect.top) / rect.height, 0.09, 0.91);

    applySpeakerPosition();
    updateSpatial();
  };

  room.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    dragging = true;
    pointerId = event.pointerId;
    try {
      if (room.setPointerCapture) room.setPointerCapture(event.pointerId);
    } catch (error) {
      /* Synthetic pointers and some browsers do not support capture. */
    }

    moveTo(event.clientX, event.clientY);
    event.preventDefault();
  });

  room.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    moveTo(event.clientX, event.clientY);
    event.preventDefault();
  });

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    try {
      if (pointerId !== null && room.hasPointerCapture && room.hasPointerCapture(pointerId)) {
        room.releasePointerCapture(pointerId);
      }
    } catch (error) {
      /* Ignore capture release failures. */
    }
    pointerId = null;
  };

  room.addEventListener("pointerup", stopDragging);
  room.addEventListener("pointercancel", stopDragging);

  dom.speaker.addEventListener("keydown", (event) => {
    const step = 0.04;
    let handled = true;

    switch (event.key) {
      case "ArrowLeft":
        state.speaker.x = clamp(state.speaker.x - step, 0.07, 0.93);
        break;
      case "ArrowRight":
        state.speaker.x = clamp(state.speaker.x + step, 0.07, 0.93);
        break;
      case "ArrowUp":
        state.speaker.y = clamp(state.speaker.y - step, 0.09, 0.91);
        break;
      case "ArrowDown":
        state.speaker.y = clamp(state.speaker.y + step, 0.09, 0.91);
        break;
      case "Home":
        state.speaker = { x: 0.5, y: 0.5 };
        break;
      default:
        handled = false;
    }

    if (!handled) return;

    event.preventDefault();
    event.stopPropagation();
    applySpeakerPosition();
    updateSpatial();
  });

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => {
      applySpeakerPosition();
      updateBeam();
    });
    observer.observe(room);
  } else {
    window.addEventListener("resize", updateBeam);
  }
}

/* --------------------------------------------------------------------------
   Playlist
   -------------------------------------------------------------------------- */

function updateCounts() {
  dom.trackCount.textContent = String(state.tracks.length).padStart(2, "0");
  dom.clearPlaylist.disabled = state.tracks.length === 0;
  dom.prevBtn.disabled = state.tracks.length === 0;
  dom.nextBtn.disabled = state.tracks.length === 0;
}

function updatePlaylistPlaying() {
  const items = dom.playlist.children;

  for (let i = 0; i < items.length; i += 1) {
    items[i].classList.toggle("is-playing", i === state.current && state.playing);
  }
}

function renderPlaylist() {
  const fragment = document.createDocumentFragment();

  state.tracks.forEach((track, index) => {
    const item = document.createElement("li");
    item.className = "track";
    item.classList.toggle("is-active", index === state.current);
    item.classList.toggle("is-playing", index === state.current && state.playing);

    const main = document.createElement("button");
    main.type = "button";
    main.className = "track__main";
    main.setAttribute("aria-label", `Воспроизвести ${track.name}`);
    main.addEventListener("click", () => playTrack(index));

    const number = document.createElement("span");
    number.className = "track__index";
    number.textContent = String(index + 1).padStart(2, "0");

    const info = document.createElement("span");
    info.className = "track__info";

    const name = document.createElement("span");
    name.className = "track__name";
    name.textContent = track.name;

    const meta = document.createElement("span");
    meta.className = "track__meta";
    meta.textContent = `${track.ext} · ${formatBytes(track.size)}`;

    info.append(name, meta);

    const bars = document.createElement("span");
    bars.className = "track__bars";
    bars.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i += 1) bars.append(document.createElement("i"));

    main.append(number, info, bars);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "track__remove";
    remove.setAttribute("aria-label", `Удалить ${track.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeTrack(index);
    });

    item.append(main, remove);
    fragment.append(item);
  });

  dom.playlist.replaceChildren(fragment);
  dom.playlistEmpty.hidden = state.tracks.length > 0;
  updateCounts();
  updatePlaylistPlaying();
}

function removeTrack(index) {
  const track = state.tracks[index];
  if (!track) return;

  const wasCurrent = index === state.current;

  if (wasCurrent) {
    dom.audio.pause();
    dom.audio.removeAttribute("src");
    dom.audio.load();
    state.current = -1;
    setPlaying(false);
  }

  URL.revokeObjectURL(track.url);
  state.tracks.splice(index, 1);

  if (wasCurrent) {
    resetNowPlaying();
    if (state.tracks.length > 0) {
      playTrack(Math.min(index, state.tracks.length - 1));
    }
  } else if (index < state.current) {
    state.current -= 1;
  }

  renderPlaylist();
  updateProgress();
}

function clearPlaylist() {
  if (state.tracks.length === 0) return;

  dom.audio.pause();
  dom.audio.removeAttribute("src");
  dom.audio.load();

  state.tracks.forEach((track) => URL.revokeObjectURL(track.url));
  state.tracks = [];
  state.current = -1;

  setPlaying(false);
  resetNowPlaying();
  renderPlaylist();
  updateProgress();
  showToast("Плейлист очищен");
}

/* --------------------------------------------------------------------------
   Playback
   -------------------------------------------------------------------------- */

function playTrack(index) {
  const track = state.tracks[index];
  if (!track) return;

  if (index === state.current && !dom.audio.paused) return;
  if (index === state.current && dom.audio.paused) {
    playAudio();
    return;
  }

  state.current = index;
  dom.audio.src = track.url;
  dom.audio.load();

  dom.trackTitle.textContent = track.name;
  dom.tapeTitle.textContent = track.name;
  document.title = `${track.name} — M'uzie`;

  renderPlaylist();
  updateProgress();
  playAudio();
}

async function playAudio() {
  if (state.current < 0) {
    showToast("Сначала загрузите музыку");
    return;
  }

  engine.init();
  engine.resume();

  try {
    await dom.audio.play();
  } catch (error) {
    setPlaying(false);
    showToast("Не удалось воспроизвести файл. Попробуйте другой формат.");
  }
}

function togglePlay() {
  if (state.tracks.length === 0) {
    showToast("Загрузите музыку, чтобы начать");
    return;
  }

  if (state.current < 0) {
    playTrack(0);
    return;
  }

  if (dom.audio.paused) {
    playAudio();
  } else {
    dom.audio.pause();
  }
}

function nextTrack() {
  if (state.tracks.length === 0) return;
  const next = (state.current + 1 + state.tracks.length) % state.tracks.length;
  playTrack(next);
}

function prevTrack() {
  if (state.tracks.length === 0) return;

  if (dom.audio.currentTime > 3) {
    dom.audio.currentTime = 0;
    updateProgress();
    return;
  }

  const prev = (state.current - 1 + state.tracks.length) % state.tracks.length;
  playTrack(prev);
}

function setPlaying(playing) {
  state.playing = playing;

  dom.playBtn.dataset.playing = String(playing);
  dom.playBtn.setAttribute("aria-label", playing ? "Пауза" : "Воспроизвести");
  dom.cassette.classList.toggle("is-playing", playing);
  dom.room.classList.toggle("is-playing", playing);

  updatePlaylistPlaying();
}

function resetNowPlaying() {
  dom.trackTitle.textContent = "Ничего не выбрано";
  dom.tapeTitle.textContent = "NO TAPE";
  document.title = COPY_TITLE;

  dom.timeCurrent.textContent = "0:00";
  dom.timeTotal.textContent = "0:00";
  dom.progress.value = "0";
  dom.progress.style.setProperty("--progress", "0%");
  dom.progress.disabled = true;
}

/* --------------------------------------------------------------------------
   Progress
   -------------------------------------------------------------------------- */

function updateProgress() {
  const duration = Number.isFinite(dom.audio.duration) ? dom.audio.duration : 0;
  const current = Number.isFinite(dom.audio.currentTime) ? dom.audio.currentTime : 0;
  const ratio = duration > 0 ? clamp(current / duration, 0, 1) : 0;

  dom.progress.value = String(Math.round(ratio * 1000));
  dom.progress.style.setProperty("--progress", `${ratio * 100}%`);
  dom.progress.disabled = duration === 0;

  dom.timeCurrent.textContent = formatTime(current);
  dom.timeTotal.textContent = formatTime(duration);
}

function initProgress() {
  dom.progress.addEventListener("input", () => {
    state.seeking = true;

    const duration = Number.isFinite(dom.audio.duration) ? dom.audio.duration : 0;
    const ratio = Number(dom.progress.value) / 1000;

    dom.progress.style.setProperty("--progress", `${ratio * 100}%`);
    if (duration > 0) {
      dom.timeCurrent.textContent = formatTime(ratio * duration);
    }
  });

  dom.progress.addEventListener("change", () => {
    const duration = Number.isFinite(dom.audio.duration) ? dom.audio.duration : 0;

    if (duration > 0) {
      dom.audio.currentTime = (Number(dom.progress.value) / 1000) * duration;
    }

    state.seeking = false;
    updateProgress();
  });

  dom.audio.addEventListener("timeupdate", () => {
    if (!state.seeking) updateProgress();
  });

  dom.audio.addEventListener("loadedmetadata", updateProgress);
  dom.audio.addEventListener("durationchange", updateProgress);
  dom.audio.addEventListener("ended", () => {
    if (state.tracks.length > 1) {
      playTrack((state.current + 1) % state.tracks.length);
    } else {
      dom.audio.currentTime = 0;
      setPlaying(false);
      updateProgress();
    }
  });

  dom.audio.addEventListener("error", () => {
    if (state.current < 0 || !dom.audio.src) return;
    setPlaying(false);
    showToast("Файл не удалось воспроизвести — возможно, формат не поддерживается");
  });

  dom.audio.addEventListener("play", () => setPlaying(true));
  dom.audio.addEventListener("pause", () => setPlaying(false));
}

/* --------------------------------------------------------------------------
   Volume
   -------------------------------------------------------------------------- */

function applyVolume() {
  const level = state.muted ? 0 : state.volume;

  engine.setVolume(level);

  dom.volume.value = String(Math.round(state.volume * 100));
  dom.volume.style.setProperty("--vol", `${state.volume * 100}%`);
  dom.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
  dom.muteBtn.dataset.muted = String(state.muted);
  dom.muteBtn.setAttribute("aria-label", state.muted ? "Включить звук" : "Выключить звук");
}

function setVolumeLevel(value, persist = true) {
  state.volume = clamp(value, 0, 1);
  state.muted = false;
  applyVolume();
  if (persist) storeVolume(state.volume);
}

function initVolume() {
  state.volume = readStoredVolume();
  applyVolume();

  dom.volume.addEventListener("input", () => {
    setVolumeLevel(Number(dom.volume.value) / 100);
  });

  dom.muteBtn.addEventListener("click", () => {
    state.muted = !state.muted;
    applyVolume();
  });
}

/* --------------------------------------------------------------------------
   Visualizer
   -------------------------------------------------------------------------- */

function initVisualizer() {
  const canvas = dom.canvas;
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) return;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let data = new Uint8Array(128);
  let time = 0;
  let topBin = 24;

  const resize = () => {
    const rect = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  resize();

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas.parentElement);
  } else {
    window.addEventListener("resize", resize);
  }

  const bars = 128;
  const levels = new Float32Array(bars);

  const render = () => {
    window.requestAnimationFrame(render);
    if (!width || !height) return;

    time += 0.016;
    ctx2d.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const size = Math.min(width, height);
    const inner = size * 0.185;
    const half = bars / 2;
    const usable = Math.max(2, Math.floor(data.length * 0.78));

    let analyser = engine.analyser;
    let live = false;

    if (analyser && state.playing) {
      if (data.length !== analyser.frequencyBinCount) {
        data = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(data);
      live = true;

      // Follow the audible top of the spectrum: the lowpass filter dulls the
      // highs as the speaker moves away, so the rose adapts instead of dying.
      let top = 12;
      for (let b = usable - 1; b >= 0; b -= 1) {
        if (data[b] > 6) {
          top = Math.max(b, 12);
          break;
        }
      }
      topBin += (top - topBin) * 0.08;
    }

    const span = clamp(Math.round(topBin), 12, usable - 1);

    const halo = ctx2d.createRadialGradient(
      centerX,
      centerY,
      inner * 0.4,
      centerX,
      centerY,
      inner * 2.05
    );
    halo.addColorStop(0, "rgba(142, 240, 255, 0.11)");
    halo.addColorStop(0.55, "rgba(177, 140, 255, 0.05)");
    halo.addColorStop(1, "rgba(142, 240, 255, 0)");
    ctx2d.fillStyle = halo;
    ctx2d.beginPath();
    ctx2d.arc(centerX, centerY, inner * 2.05, 0, Math.PI * 2);
    ctx2d.fill();

    // A faint guide circle keeps the rose readable while the track is quiet.
    ctx2d.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.arc(centerX, centerY, inner, 0, Math.PI * 2);
    ctx2d.stroke();

    ctx2d.lineCap = "round";
    ctx2d.lineWidth = Math.max(1.4, size * 0.0045);

    for (let i = 0; i < bars; i += 1) {
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;

      // Mirror the spectrum: both halves of the ring share the same bins.
      const m = i < half ? i : bars - 1 - i;
      const norm = m / (half - 1);

      let target;
      if (live) {
        // Log-ish spread: bass gets more of the ring than the airy top end.
        const index = Math.floor(Math.pow(norm, 1.1) * span);
        const spectrum = Math.pow(data[index] / 255, 0.78);
        // A breathing floor keeps the rose complete on bass-heavy tracks.
        const floor = 0.06 + 0.04 * Math.sin(m * 0.5 + time * 1.4);
        target = Math.max(spectrum, floor);
      } else {
        target = 0.1 + 0.045 * Math.sin(time * 1.3 + m * 0.32);
      }

      levels[i] += (target - levels[i]) * (live ? 0.32 : 0.06);
      const value = levels[i];

      const length = inner * 0.06 + Math.pow(value, 1.2) * inner * 1.35;
      const startX = centerX + Math.cos(angle) * inner;
      const startY = centerY + Math.sin(angle) * inner;
      const endX = centerX + Math.cos(angle) * (inner + length);
      const endY = centerY + Math.sin(angle) * (inner + length);

      const hue = 186 + norm * 128;
      const alpha = 0.09 + value * 0.82;

      ctx2d.strokeStyle = `hsla(${hue}, 100%, 72%, ${alpha})`;
      ctx2d.beginPath();
      ctx2d.moveTo(startX, startY);
      ctx2d.lineTo(endX, endY);
      ctx2d.stroke();
    }
  };

  render();
}

/* --------------------------------------------------------------------------
   Uploads and drag & drop
   -------------------------------------------------------------------------- */

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const valid = [];
  const invalid = [];

  files.forEach((file) => {
    if (isAudioFile(file)) valid.push(file);
    else invalid.push(file);
  });

  if (valid.length === 0) {
    showToast(
      invalid.length === 1
        ? `«${invalid[0].name}» — это не аудиофайл`
        : `Это не аудиофайлы: ${invalid.length}`
    );
    return;
  }

  const startIndex = state.tracks.length;

  valid.forEach((file) => {
    const extension = (file.name.split(".").pop() || "audio").toUpperCase();

    state.tracks.push({
      id: (trackSeq += 1),
      name: cleanName(file.name),
      ext: extension,
      size: file.size,
      url: URL.createObjectURL(file),
    });
  });

  renderPlaylist();

  if (state.current < 0) {
    playTrack(startIndex);
  }

  const parts = [];
  if (valid.length > 0) parts.push(`добавлено: ${valid.length}`);
  if (invalid.length > 0) parts.push(`пропущено: ${invalid.length}`);
  showToast(parts.join(" · "));
}

function initUploads() {
  dom.uploadBtn.addEventListener("click", () => dom.fileInput.click());

  dom.fileInput.addEventListener("change", () => {
    addFiles(dom.fileInput.files);
    dom.fileInput.value = "";
  });

  let dragDepth = 0;

  const hasFiles = (event) =>
    Boolean(event.dataTransfer) &&
    Array.from(event.dataTransfer.types || []).includes("Files");

  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dom.dropzone.classList.add("is-visible");
  });

  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dom.dropzone.classList.remove("is-visible");
  });

  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    dom.dropzone.classList.remove("is-visible");

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  });
}

/* --------------------------------------------------------------------------
   Keyboard shortcuts
   -------------------------------------------------------------------------- */

function seekBy(delta) {
  const duration = Number.isFinite(dom.audio.duration) ? dom.audio.duration : 0;
  if (duration === 0) return;

  dom.audio.currentTime = clamp(dom.audio.currentTime + delta, 0, duration);
  updateProgress();
}

function initKeyboard() {
  document.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "BUTTON" || tag === "TEXTAREA" || tag === "SELECT") {
      return;
    }

    switch (event.code) {
      case "Space":
        event.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        event.preventDefault();
        seekBy(5);
        break;
      case "ArrowLeft":
        event.preventDefault();
        seekBy(-5);
        break;
      case "ArrowUp":
        event.preventDefault();
        setVolumeLevel(state.volume + 0.05);
        break;
      case "ArrowDown":
        event.preventDefault();
        setVolumeLevel(state.volume - 0.05);
        break;
      default:
        break;
    }
  });
}

/* --------------------------------------------------------------------------
   Transport buttons
   -------------------------------------------------------------------------- */

function initTransport() {
  dom.playBtn.addEventListener("click", togglePlay);
  dom.nextBtn.addEventListener("click", nextTrack);
  dom.prevBtn.addEventListener("click", prevTrack);
  dom.clearPlaylist.addEventListener("click", clearPlaylist);
}

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */

function initPlayer() {
  if (!(window.AudioContext || window.webkitAudioContext)) {
    engine.supported = false;
    dom.spatialNotice.hidden = false;
    dom.spatialNotice.textContent = "Web Audio API не поддерживается — доступно обычное стерео";
    dom.room.classList.add("is-flat");
  }

  initUploads();
  initRoom();
  initProgress();
  initVolume();
  initVisualizer();
  initTransport();
  initKeyboard();

  renderPlaylist();
  resetNowPlaying();
  updateProgress();
  updateSpatial();

  window.addEventListener("beforeunload", () => {
    state.tracks.forEach((track) => URL.revokeObjectURL(track.url));
  });
}

initPlayer();
