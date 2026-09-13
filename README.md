# Food Diary

A private food and symptom diary for a breastfeeding parent doing an
elimination diet. Log meals (tagged by allergen) and the baby's symptoms; the
app lines them up with the 24 to 72 hour lag that milk-protein reactions have,
and produces a printable report to discuss with a pediatrician. Correlation,
not diagnosis.

Live at https://cjmerc39.github.io/food-diary/. Add it to the Home Screen from
that address before logging real data: only the installed copy is exempt from
Safari's storage eviction, and browser and Home Screen copies don't share data.

## Privacy

Nothing leaves the phone. The app makes no network calls with diary data: no
accounts, analytics, web fonts, or APIs. The service worker caches the app's
own files so it works offline; the diary itself lives only in localStorage.
Export a JSON backup from More now and then, because deleting the Home Screen
app deletes its data.

## Using it

- **Today:** `+ food` and `+ symptom` on every tab; tap an entry to edit or
  delete it; arrows, the date, or a swipe change the day.
- **Trends:** daily symptom load with phase bands, per-category strips, and
  the suspects list (correlation, not diagnosis).
- **Phases:** eliminations and reintroductions; they drive the exposure
  banners on Today and the 72-hour watch card.
- **More > Report:** a print-styled summary for the pediatrician. Print, or
  save a PDF from the print preview.
- **More > Back up now:** saves the whole diary as a JSON file (the share sheet
  on iPhone). **Restore** merges a backup in by id, or replaces the diary after
  a confirm; both can be undone right after.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app: markup, styles, UI code |
| `logic.js` | Pure computation (time math, state loading, phases, tags), an ES module shared by the browser and the tests |
| `logic.test.js` | Tests for `logic.js` |
| `sw.js` | Cache-first service worker for the app shell |
| `manifest.json` | PWA manifest |
| `make-icons.js` | Regenerates `icon-180.png`, `icon-192.png`, `icon-512.png` |

No framework, no build step, no npm dependencies.

## Develop

```sh
node --test            # run the tests
node make-icons.js     # regenerate icons
```

`index.html` loads `logic.js` as a module, which browsers refuse over
`file://`. Preview through any local static server instead.

## Deploy

Push to `main`; GitHub Pages serves the repo root. On every deploy, bump
`VERSION` in `sw.js` and `BUILD` in `index.html` together. Installed copies
then show "A new version is ready" with a Reload button.

## Data safety rules

- State lives under the localStorage key `food-diary:state`. All apps on
  `cjmerc39.github.io` share one localStorage and one Cache Storage, so this app
  only touches its own key prefix and its own `food-diary-shell-` caches. Never
  call `localStorage.clear()`.
- `state.v` is the schema version. Migrations are additive. A build that finds
  a newer version refuses to open or write the diary rather than guess.
- Unreadable saved data is set aside under `food-diary:state:unreadable:<time>`
  before a fresh diary starts.

## Renaming

The display name lives in `APP_NAME` in `index.html`. A few static spots can't
read it and need a manual edit: `manifest.json` (`name`, `short_name`), and the
`<title>` and `apple-mobile-web-app-title` tags in `index.html`. Do not change
`STORE_KEY` or the cache `PREFIX`: renaming must not orphan saved diaries.
