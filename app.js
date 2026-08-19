(() => {
  const RAMP_SECONDS = 0.1;
  const SEEK_MAX = 1000;

  const songSelect = document.getElementById('song-select');
  const trackTitle = document.getElementById('track-title');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const vocalToggleBtn = document.getElementById('vocal-toggle-btn');
  const seekBar = document.getElementById('seek-bar');
  const timeCurrent = document.getElementById('time-current');
  const timeDuration = document.getElementById('time-duration');
  const statusEl = document.getElementById('status');

  let audioCtx = null;
  let songs = [];

  let fullMixBuffer = null;
  let instrumentalBuffer = null;
  let duration = 0;

  let fullMixGain = null;
  let instrumentalGain = null;

  let fullMixSource = null;
  let instrumentalSource = null;

  let isPlaying = false;
  let vocalsOn = true;
  let playbackStartCtxTime = 0; // audioCtx.currentTime when current playback segment started
  let playbackStartOffset = 0;  // song-position (s) at that moment
  let isSeeking = false;
  let rafId = null;
  let loadToken = 0; // guards against a slow load finishing after the user picked another song

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function getCurrentPosition() {
    if (!isPlaying) return playbackStartOffset;
    return playbackStartOffset + (audioCtx.currentTime - playbackStartCtxTime);
  }

  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      fullMixGain = audioCtx.createGain();
      instrumentalGain = audioCtx.createGain();
      fullMixGain.connect(audioCtx.destination);
      instrumentalGain.connect(audioCtx.destination);
    }
  }

  function stopSources() {
    if (fullMixSource) {
      fullMixSource.onended = null;
      try { fullMixSource.stop(); } catch (e) {}
      fullMixSource.disconnect();
      fullMixSource = null;
    }
    if (instrumentalSource) {
      try { instrumentalSource.stop(); } catch (e) {}
      instrumentalSource.disconnect();
      instrumentalSource = null;
    }
  }

  function resetPlaybackState() {
    stopSources();
    isPlaying = false;
    playbackStartOffset = 0;
    stopProgressLoop();
    playPauseBtn.textContent = 'Play';
    updateSeekUI(0);
  }

  async function loadSong(song) {
    const myToken = ++loadToken;
    resetPlaybackState();

    ensureAudioContext();
    playPauseBtn.disabled = true;
    vocalToggleBtn.disabled = true;
    trackTitle.textContent = `${song.artist} — ${song.title}`;
    statusEl.textContent = 'Loading audio…';
    timeDuration.textContent = '0:00';

    const [fullMixData, instrumentalData] = await Promise.all([
      fetch(song.fullMix).then(r => {
        if (!r.ok) throw new Error(`Failed to fetch ${song.fullMix}: ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(song.instrumental).then(r => {
        if (!r.ok) throw new Error(`Failed to fetch ${song.instrumental}: ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);

    const [decodedFullMix, decodedInstrumental] = await Promise.all([
      audioCtx.decodeAudioData(fullMixData),
      audioCtx.decodeAudioData(instrumentalData),
    ]);

    if (myToken !== loadToken) return; // a newer song was selected while this one was loading

    fullMixBuffer = decodedFullMix;
    instrumentalBuffer = decodedInstrumental;
    duration = Math.min(fullMixBuffer.duration, instrumentalBuffer.duration);
    timeDuration.textContent = formatTime(duration);

    vocalsOn = true;
    fullMixGain.gain.cancelScheduledValues(audioCtx.currentTime);
    instrumentalGain.gain.cancelScheduledValues(audioCtx.currentTime);
    fullMixGain.gain.value = 1;
    instrumentalGain.gain.value = 0;
    vocalToggleBtn.textContent = 'Vocals: On';
    vocalToggleBtn.classList.remove('vocals-off');

    playPauseBtn.disabled = false;
    vocalToggleBtn.disabled = false;
    statusEl.textContent = 'Ready.';
  }

  function startSourcesAt(offset) {
    stopSources();

    fullMixSource = audioCtx.createBufferSource();
    fullMixSource.buffer = fullMixBuffer;
    fullMixSource.connect(fullMixGain);

    instrumentalSource = audioCtx.createBufferSource();
    instrumentalSource.buffer = instrumentalBuffer;
    instrumentalSource.connect(instrumentalGain);

    const startAt = audioCtx.currentTime + 0.02; // tiny lookahead so both start truly together
    fullMixSource.start(startAt, offset);
    instrumentalSource.start(startAt, offset);

    fullMixSource.onended = () => {
      if (isPlaying && getCurrentPosition() >= duration - 0.05) {
        handleEnded();
      }
    };

    playbackStartCtxTime = startAt;
    playbackStartOffset = offset;
  }

  function handleEnded() {
    isPlaying = false;
    stopSources();
    playbackStartOffset = 0;
    playPauseBtn.textContent = 'Play';
    stopProgressLoop();
    updateSeekUI(0);
  }

  function play() {
    if (isPlaying || !fullMixBuffer) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const offset = getCurrentPosition() >= duration ? 0 : getCurrentPosition();
    startSourcesAt(offset);
    isPlaying = true;
    playPauseBtn.textContent = 'Pause';
    startProgressLoop();
  }

  function pause() {
    if (!isPlaying) return;
    const pos = getCurrentPosition();
    stopSources();
    isPlaying = false;
    playbackStartOffset = Math.min(pos, duration);
    playPauseBtn.textContent = 'Play';
    stopProgressLoop();
  }

  function seekTo(offsetSeconds) {
    const clamped = Math.max(0, Math.min(duration, offsetSeconds));
    if (isPlaying) {
      startSourcesAt(clamped);
    } else {
      playbackStartOffset = clamped;
    }
    updateSeekUI(clamped);
  }

  function updateSeekUI(position) {
    timeCurrent.textContent = formatTime(position);
    if (!isSeeking) {
      seekBar.value = duration > 0 ? Math.round((position / duration) * SEEK_MAX) : 0;
    }
  }

  function startProgressLoop() {
    stopProgressLoop();
    const tick = () => {
      if (!isPlaying) return;
      const pos = getCurrentPosition();
      if (pos >= duration) {
        handleEnded();
        return;
      }
      updateSeekUI(pos);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopProgressLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function rampGain(param, target) {
    const now = audioCtx.currentTime;
    const current = param.value; // automation-aware current value
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(target, now + RAMP_SECONDS);
  }

  function toggleVocals() {
    vocalsOn = !vocalsOn;
    if (vocalsOn) {
      rampGain(fullMixGain.gain, 1);
      rampGain(instrumentalGain.gain, 0);
      vocalToggleBtn.textContent = 'Vocals: On';
      vocalToggleBtn.classList.remove('vocals-off');
    } else {
      rampGain(fullMixGain.gain, 0);
      rampGain(instrumentalGain.gain, 1);
      vocalToggleBtn.textContent = 'Vocals: Off';
      vocalToggleBtn.classList.add('vocals-off');
    }
  }

  playPauseBtn.addEventListener('click', () => {
    if (isPlaying) pause(); else play();
  });

  vocalToggleBtn.addEventListener('click', toggleVocals);

  seekBar.addEventListener('input', () => {
    isSeeking = true;
    const position = (seekBar.value / SEEK_MAX) * duration;
    timeCurrent.textContent = formatTime(position);
  });

  seekBar.addEventListener('change', () => {
    const position = (seekBar.value / SEEK_MAX) * duration;
    seekTo(position);
    isSeeking = false;
  });

  songSelect.addEventListener('change', () => {
    const song = songs.find(s => s.id === songSelect.value);
    if (song) {
      loadSong(song).catch(err => {
        console.error(err);
        statusEl.textContent = `Error loading audio: ${err.message}`;
      });
    }
  });

  async function init() {
    const res = await fetch('songs.json');
    if (!res.ok) throw new Error(`Failed to fetch songs.json: ${res.status}`);
    songs = await res.json();

    songSelect.innerHTML = '';
    for (const song of songs) {
      const option = document.createElement('option');
      option.value = song.id;
      option.textContent = `${song.title} — ${song.artist}`;
      songSelect.appendChild(option);
    }
    songSelect.disabled = false;

    if (songs.length > 0) {
      songSelect.value = songs[0].id;
      await loadSong(songs[0]);
    } else {
      statusEl.textContent = 'No songs found.';
    }
  }

  init().catch(err => {
    console.error(err);
    statusEl.textContent = `Error loading songs: ${err.message}`;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(err => {
        console.error('Service worker registration failed:', err);
      });
    });
  }
})();
