# Salamander Grand Piano

Piano recordings by **Alexander Holm**, Yamaha C5, Salamander Grand Piano.
Licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
Original recordings / conversion distribution: [Tonejs/audio, salamander](https://github.com/Tonejs/audio/tree/master/salamander).
See `SOURCE-README.txt` for the upstream description, and `manifest.json` for file sizes and SHA-256.

This application bundles 30 unmodified MP3 recordings at minor-third intervals from A0 through C8. This is a **single velocity layer subset**, not the full 16-layer SFZ library described upstream. The player changes gain and low-pass filtering with velocity, resamples the nearest recorded pitch, and applies note-off release and a master compressor. No external sample CDN is used at runtime.
