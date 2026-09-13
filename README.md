# Food Diary

A private food and symptom diary for a breastfeeding parent doing an
elimination diet. Log meals (tagged by allergen) and the baby's symptoms; the
app lines them up with the 24 to 72 hour lag that milk-protein reactions have,
and produces a printable report to discuss with a pediatrician. Correlation,
not diagnosis.

Live at https://cjmerc39.github.io/food-diary/. Add it to the Home Screen from
that address before logging real data: only the installed copy is exempt from
Safari's storage eviction, and browser and Home Screen copies don't share data.

**Status:** v1.0 is complete (tag `v1.0`, build 5). Suggested allergen tags for
free-text meals are parked for a later phase; nothing in v1 depends on them.

## Privacy

Nothing leaves the phone. The app makes no network calls with diary data: no
accounts, analytics, web fonts, or APIs. The service worker caches the app's
own files so it works offline; the diary itself lives only in localStorage.

## Using it

- **Today:** a glance card at the top of each day shows the baby's name, each
  phase running that day with its day number (tap to open Phases), and the
  day's symptom load and entry count; past days show their own picture.
  `+ food` and `+ symptom` sit on every tab. A saved meal logs in two taps, a
  loose diaper in four. Tap an entry to edit or delete it; arrows, the date, or
  a swipe change the day. Every entry's time can be backdated.
- **Trends:** daily symptom load with one track per phase food behind the
  line, per-category strips, and the suspects list with its window editable
  inline. Correlation, not diagnosis.
- **Phases:** eliminations and reintroductions. They drive the exposure
  banners on Today and the 72-hour reintroduction watch card.
- **More > Report:** a print-styled summary for the pediatrician. Print (it
  works from the Home Screen app), save a PDF from the print preview, or
  **Share as a file** for a printable copy in Files, Mail, or AirDrop.
- **More > Back up now:** saves the whole diary as a JSON file through the
  share sheet. Once the diary has entries and two weeks pass without a backup,
  Today shows a gentle reminder; **Later** hides it for a week.
- **More > Settings > Appearance:** System (follows the phone's Light or Dark
  setting), Light, or Dark. Kept on the phone under its own key, so it's not
  part of the diary or its backups.
- **Restore:** from More, or from the welcome screen on a new phone. Merge adds
  what the phone doesn't have (the phone's copy wins on a clash); Replace swaps
  the diary after a confirm; both can be undone right after. Only this app's
  backup files are accepted, and damaged entries are left out.
- **Motion:** controls give a small spring on tap (a calm settle instead, with
  no bounce, for severity 3, watery stool, and blood), sheets ease in and out,
  saves draw a check in the toast, day paging slides with the swipe, and the
  Trends line draws in on each range's first view. Personality and motion stay
  away from symptom data: the bowl-and-drop mark settles in food-log toasts and
  on quiet days (a moon late at night, a sun in the morning, a leaf on a past
  day with food and no symptoms), while a sparse day with symptoms shows only
  the plain mark, at rest. A short welcome plays once per session at launch,
  one of four entrances picked at random (the drop falls into the bowl, steam
  rises from the empty bowl, the empty bowl rocks and settles, or the moon or
  sun rises behind it during that mark's hours), and any tap skips it.
  Everything honors Reduce Motion.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app: markup, styles, UI code |
| `logic.js` | Pure computation shared by the browser and the tests: time and day math, phases, meals and tags, symptom load, suspects, trends ranges, backups (reading, checking, merging), the backup reminder, and which mark a quiet day shows |
| `logic.test.js` | Tests for `logic.js` |
| `sw.js` | Cache-first service worker for the app shell |
| `manifest.json` | PWA manifest |
| `make-icons.js` | Regenerates `icon-180.png`, `icon-192.png`, `icon-512.png` |

No framework, no build step, no npm dependencies.

## Develop

```sh
node --test            # run the logic tests
node make-icons.js     # regenerate icons
```

`index.html` loads `logic.js` as a module, which browsers refuse over
`file://`. Preview through any local static server instead. Phone-sized browser
checks (every flow in light and dark, motion timing and Reduce Motion, storage
safety, a simulated deploy) are kept outside this repo so it stays free of
dependencies. Keep every animation under about 300ms (the launch welcome
excepted), and never add bounce to anything showing severity 3 or a
call-the-doctor note.

## Deploy

Push to `main`; GitHub Pages serves the repo root. On every deploy, bump
`VERSION` in `sw.js` and `BUILD` in `index.html` together. Installed copies
then show "A new version is ready" with a Reload button. Releases are tagged.

## Data safety rules

- State lives under the localStorage key `food-diary:state`. All apps on
  `cjmerc39.github.io` share one localStorage and one Cache Storage, so this app
  only touches its own key prefix and its own `food-diary-shell-` caches. Never
  call `localStorage.clear()`; Clear all data removes only `food-diary:` keys.
- `state.v` is the schema version. Migrations are additive. A build that finds
  a newer version refuses to open or write the diary rather than guess.
- Unreadable saved data is set aside under `food-diary:state:unreadable:<time>`
  before a fresh diary starts.
- Backup files carry `"app": "food-diary"`. Restores check every entry (safe
  ids and tags, known categories, valid dates, no repeated ids) and leave out
  anything damaged.

## Renaming

The display name lives in `APP_NAME` in `index.html`. A few static spots can't
read it and need a manual edit: `manifest.json` (`name`, `short_name`), and the
`<title>` and `apple-mobile-web-app-title` tags in `index.html`. Do not change
`STORE_KEY`, `APP_ID`, or the cache `PREFIX`: renaming must not orphan saved
diaries or make old backups unreadable.
