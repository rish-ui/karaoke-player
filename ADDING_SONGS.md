# Adding a new song to the karaoke player

Self-contained runbook for turning two YouTube rips (a "full mix" / lyrics
rip and a separately-downloaded "instrumental" rip) into a sample-aligned
`full_mix.wav` + `instrumental.wav` pair, and wiring it into the app.

## Why not just use the two YouTube rips directly

Two files ripped from different YouTube videos are almost never the same
length or start offset (different intro silence, different edit). Check
first with ffprobe — if durations differ by more than a few ms, do NOT use
the separately-ripped "instrumental" file. Instead, run Demucs on the full
mix file to derive an instrumental that's guaranteed sample-aligned with it.

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "full_mix_rip.mp3"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "instrumental_rip.mp3"
```

## Prerequisites (one-time setup)

```bash
pip install -U demucs numpy   # numpy isn't always pulled in automatically — install explicitly
winget install --id Gyan.FFmpeg -e --source winget --accept-package-agreements --accept-source-agreements
```

ffmpeg/ffprobe installed via winget land under:
`%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\`
— either add that to PATH or reference the full path directly. A shell restart is needed to pick up the PATH change from winget; referencing the full path avoids that.

## Step 1 — Run Demucs on the full mix (not the instrumental rip)

```bash
python -m demucs --two-stems=vocals -n htdemucs --out "./separated" "full_mix_rip.mp3"
```

This is CPU-only inference (no GPU setup done here) — takes a few minutes per song, longer on first run since it also downloads the ~80MB model. Run it in the background and poll for completion rather than blocking.

Output lands at:
`./separated/htdemucs/<input-filename-without-extension>/vocals.wav`
`./separated/htdemucs/<input-filename-without-extension>/no_vocals.wav`

These two are guaranteed the same duration and sample-aligned (same decode pass, same model).

## Step 2 — Verify alignment

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=sample_rate,channels -of default=noprint_wrappers=1 "vocals.wav"
ffprobe -v error -show_entries format=duration -show_entries stream=sample_rate,channels -of default=noprint_wrappers=1 "no_vocals.wav"
```

Durations must match exactly (to the sample / same float value).

## Step 3 — Rebuild the full mix from the stems (don't reuse the original rip)

Mixing `vocals.wav + no_vocals.wav` back together — rather than using the
original MP3 rip re-encoded to WAV — guarantees the "full mix" output is
exactly the same length/offset as the instrumental, since both come from
the same Demucs decode pass. `normalize=0` is required or ffmpeg's amix
will auto-attenuate by 1/n.

```bash
ffmpeg -y -i "vocals.wav" -i "no_vocals.wav" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[out]" \
  -map "[out]" "full_mix_raw.wav"
```

## Step 4 — Check loudness and peaks, normalize if needed

```bash
ffmpeg -i "full_mix_raw.wav" -af volumedetect -f null - 2>&1 | grep -E "max_volume|mean_volume"
ffmpeg -i "no_vocals.wav" -af volumedetect -f null - 2>&1 | grep -E "max_volume|mean_volume"
```

If `mean_volume` differs by more than ~1dB between the two, apply a flat
gain trim to whichever is louder (usually the full mix, since it has vocal
energy on top of the instrumental):

```bash
ffmpeg -y -i "full_mix_raw.wav" -af "volume=-1.2dB" "full_mix.wav"   # adjust dB to match mean_volume of no_vocals
```

**Important:** only use a static `volume=XdB` filter, never `loudnorm` or
other dynamics/lookahead-based normalization filters. Those can introduce a
few milliseconds of variable delay depending on content, which would
desync the two tracks. A flat gain multiplier changes no sample count and
no timing, so alignment is preserved exactly.

Check the resulting `max_volume` stays below 0dB (no clipping) after the trim.

## Step 5 — Place files and update the manifest

```bash
mkdir -p "karaoke-player/audio/<song-id>"
# full_mix.wav → karaoke-player/audio/<song-id>/full_mix.wav
# no_vocals.wav (or the copy) → karaoke-player/audio/<song-id>/instrumental.wav
```

Add an entry to `karaoke-player/songs.json`:

```json
{
  "id": "<song-id>",
  "title": "<Song Title>",
  "artist": "<Artist>",
  "fullMix": "audio/<song-id>/full_mix.wav",
  "instrumental": "audio/<song-id>/instrumental.wav"
}
```

No other code changes needed — `app.js` reads `songs.json` at load time and
populates the song picker automatically. The service worker caches audio
files at runtime on first fetch, so no cache-version bump is needed for
adding a song (only bump `CACHE_NAME` in `service-worker.js` if you change
`index.html`/`app.js`/`style.css`/`songs.json`'s *structure*, since those are
precached on install and won't otherwise be re-fetched).

## Step 6 — Clean up

Delete the `separated/` working directory (large intermediate WAVs, ~150MB+
per song) once the final two files are copied into `audio/<song-id>/`.
