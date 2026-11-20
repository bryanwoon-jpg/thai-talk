# Thai Talk

A Preply-inspired game for learning conversational Thai. You pick a tutor and chat your way through real-life scenes. Every line shows romanization with tone marks, the Thai script and the English, and a Thai voice can read it aloud. It installs on your phone's home screen as a progressive web app (PWA) and works offline.

## What's inside

- **4 tutors, 8 lessons:** Pa Noi (food and ordering), P'Ton (getting around), Je Lek (shopping and bargaining) and Fon (small talk with colleagues).
- **Choices mode:** pick the natural reply from 3 options. An awkward reply gets a tip and a wrong one gets a hint.
- **Tiles mode:** build the reply word by word for 1.5x XP. It unlocks after your first run of a lesson.
- **Speaking:** tap 🎙️ to say your reply in Thai. This works where the browser supports Thai speech recognition (Chrome on Android, Safari on iPhone).
- **Progress:** a daily streak, XP, tutor levels, 1 to 3 stars per lesson, and a phrasebook with spaced flashcard review.
- **Polite particle:** khráp (male speaker) is used throughout.

Progress is saved on the device. An installed app on iPhone keeps its own storage, separate from Safari.

## Install on your phone

1. Open the deployed URL.
2. **iPhone (Safari):** tap Share, then **Add to Home Screen**.
3. **Android (Chrome):** tap **Install** on the home screen card, or open the browser menu and choose **Install app**.

If you don't hear Thai audio, add a Thai voice:

- **iPhone:** Settings › Accessibility › Spoken Content › Voices › Thai.
- **Android:** Settings › Text-to-speech › Google Speech Services › install Thai.

## Deploy on Vercel

It's a static site with no build step.

1. In Vercel, choose **Add New → Project** and import this repo.
2. Leave **Framework Preset** as **Other**. Leave the build command empty and the output directory as the default (the repo root).
3. Deploy.

`vercel.json` sets the cache headers the service worker and manifest need, and allows the microphone for speaking practice.

## Project layout

```
index.html            App shell
css/styles.css        Night-market theme
css/fonts.css         Self-hosted Mitr + Prompt (Thai, Latin, Latin Extended)
js/content.js         Tutors and lesson scripts (edit this to add lessons)
TOPICS.md             Queue of topics for the daily lesson task
scripts/              validate.mjs (content checks), smoke_test.py (plays every lesson)
js/app.js             Game logic: lessons, tiles, speech, streaks, phrasebook
sw.js                 Service worker (offline cache)
manifest.webmanifest  PWA manifest
icons/                App icon (icon.svg is the source) and PNG sizes
fonts/                WOFF2 files and their licenses (SIL OFL 1.1)
```

## Daily lessons

A scheduled task adds one new lesson every morning (Singapore time). It takes the first unticked topic in `TOPICS.md`, writes the lesson into `js/content.js` with an `added` date, checks it, and pushes to `main`, so Vercel redeploys on its own. In the app, the new lesson shows on the home screen with a **NEW** badge for 3 days, and daily lessons are open straight away.

To steer what comes next, edit `TOPICS.md`: reorder, add or delete lines.

## Adding a lesson by hand

Add an entry to `SCENES` in `js/content.js`. Each turn holds the tutor's line plus three replies: `[thai, romanization, english, score, note]`, where the score is 2 for natural, 1 for okay and 0 for wrong. Okay and wrong replies need a note. The first lessons for each tutor unlock in order. Lessons with an `added: "YYYY-MM-DD"` date are always open.

Before pushing:

```
node scripts/validate.mjs          # content and structure checks
python3 scripts/smoke_test.py      # plays every lesson headlessly (needs Playwright)
```

Then set `CACHE_VERSION` in `sw.js` to today's date so installed copies pick up the update. Open apps reload on their own once the new version is ready, but never mid-lesson.
