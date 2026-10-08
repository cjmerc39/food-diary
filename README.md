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
  loose diaper in four. Several symptoms can be picked in one pass: each
  category expands under the grid, and one Log saves them as separate entries
  sharing one time (Undo removes them all). After such a pass, **Save as set**
  keeps it; saved sets sit at the top of the symptom sheet, ordered by use, and
  one tap fills the sheet in, ready to adjust or log. Press and hold a set to
  rename, change, or remove it; logged entries never change. Tap an entry to
  edit or delete it; arrows, the date, or a swipe change the day. Every
  entry's time can be backdated.
- **Symptoms:** crying, spit-up, stool, gas, skin, breathing, and other. Gas
  (bloating, straining, painful wind) has its own 1 to 3 anchors; it counts
  as a symptom following a food like any other, but stays out of the 0 to 20
  load, which keeps its five clinical categories. A stool entry can stand for several
  alike diapers (a count, default one), and the glance card and daily numbers
  show the day's stools. A stool can also carry an optional color, picked from
  a color card laid out the way the infant stool colour cards used in newborn
  screening are: even tiles with the color in front, the usual range in one row
  and the three worth a call in the next. Color adds no points (green is common
  and normal); red, black, and pale each show a calm call-your-pediatrician
  note. Sets remember the color but not the count.
- **Foods:** a meal is the foods picked for it. Saved meals sit on top of the
  `+ food` sheet for a one-tap repeat (the six most used; the rest turn up when
  searching). Below them, a field finds foods as she types, with recent and
  most-used foods under it once it has focus; tapping one adds it as a chip,
  and text with no match can be added as a new food, its allergen chips right
  there. The field never grabs the keyboard on open, and while it has focus
  the sheet stands tall so the list sits above the keyboard. Allergens belong
  to foods; a saved meal's come from its foods. Each entry snapshots its
  allergens when logged, and can be adjusted for that entry alone. More >
  Foods lists every food with its allergens and use count, the ones to review
  first; each can be renamed, retagged, hidden from the picker, or merged into
  another. Merging moves saved meals and future logs to the kept food and
  leaves past entries alone, which then count toward it in Trends. After the
  update, a card on Today shows how many foods are left to review and opens
  the list; it counts down as she goes, retires for good at zero, and can be
  dismissed for good. Clearing the tags a meal kept stays her call, in the
  meal's edit sheet.
- **Solids:** every food entry records who ate it, the parent (through breast
  milk) or the baby directly. The `+ food` sheet opens with a two-way toggle
  at the top, defaulting to the parent and naming the baby; the meal library
  and foods are shared. Baby entries carry a small name pill on Today. Exposure banners
  and the reintroduction watch fire for both pathways and say who ate the food.
- **Trends:** the symptom load chart with one track per phase food behind
  the line, the per-category strips, and then three answers in plain counts,
  in this order. **Is it working**: one sentence per elimination comparing
  the two weeks before it started with the time since (average daily load,
  and days with any symptom); a phase too young, or one that began before the
  diary did, says so in one line instead. **Anything standing out**: at most
  three foods per pathway, each one sentence: how many times it was eaten, how
  many were followed by symptoms within the window, and the same for the days
  it wasn't eaten (measured from that day's first meal). Allergen tags and
  picked foods are one list; tapping a row shows the dates behind every
  count. If nothing separates from the rest, one line says so. **For the next
  visit**: the same findings as lines to read aloud to the pediatrician; the
  report carries the identical lines. No multiples, ratios, scores, or
  confidence labels anywhere, and no advice on what to eliminate or
  reintroduce next. The two pathways (what she ate, through breast milk; what
  the baby ate, once he has eaten anything) are described in plain words. The
  windows that decide what "followed" means live in More: 24h by default via
  breast milk (6h to 7 days), 4h for his own food (1/2/4/8). A window of four
  days or more shows a note there: a food eaten most days is then followed by
  nearly every symptom, so little will stand out. The ordering behind
  "standing out" lives in `logic.js` (`standingOut`): a food needs 3 days
  eaten and 3 days without, and its share of eatings followed by symptoms has
  to beat the share on days without it by a quarter. Older entries from
  before foods were picked fold in by name.
- **Phases:** eliminations and reintroductions. They drive the exposure
  banners on Today and the 72-hour reintroduction watch card.
- **More > Report:** a print-styled summary for the pediatrician, with a Who
  column in the log (stool counts and colors included) and the same three
  answers as Trends: is it working, anything standing out (with the dates),
  and for the next visit. Print (it
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
  no bounce, for severity 3, watery stool, blood, and red, black, or pale
  stool), sheets ease in and out, saves draw a check in the toast, day paging
  slides with the swipe, and the
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
| `logic.js` | Pure computation shared by the browser and the tests: time and day math, phases, meals, foods and tags, symptom load and stool counts, the three Trends answers (elimination outcomes and foods standing out), the v1 to v2 migration, trends ranges, backups (reading, checking, merging, including symptom sets), the backup reminder, and which mark a quiet day shows |
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
- `state.v` is the schema version, now 2. Migrations never drop or change a
  logged entry. Version 1 to 2 (build 15) turned free-text meals into picked
  foods: each saved meal was split into foods at its commas (never inside
  parentheses), each distinct food once and marked to review. A meal that was
  one food handed it its allergens; a meal of several keeps its own, since
  which food held them isn't knowable. Entries keep their name and tags, and
  one whose name matches a saved meal's, ignoring case and spacing (build 16;
  build 15 matched exactly), gains `items` linking it to that meal's foods;
  the rest stay older entries. Before the first save in a
  new version, the diary as it was is kept under `food-diary:state:v<old>:<time>`.
  Other additions are optional fields (symptom sets; `color` and `count` on
  stool entries, a missing count meaning one; `who` on food entries, a missing
  one meaning the parent). A build that finds a newer version refuses to open
  or write the diary rather than guess.
- Unreadable saved data is set aside under `food-diary:state:unreadable:<time>`
  before a fresh diary starts.
- Restoring an older backup runs the same migration, and foods match by name
  as well as id, so a restore never doubles a food.
- Backup files carry `"app": "food-diary"`. Restores check every entry (safe
  ids and tags, known categories, valid dates, no repeated ids) and leave out
  anything damaged.

## Renaming

The display name lives in `APP_NAME` in `index.html`. A few static spots can't
read it and need a manual edit: `manifest.json` (`name`, `short_name`), and the
`<title>` and `apple-mobile-web-app-title` tags in `index.html`. Do not change
`STORE_KEY`, `APP_ID`, or the cache `PREFIX`: renaming must not orphan saved
diaries or make old backups unreadable.
