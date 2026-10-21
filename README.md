# MnM Atlas

An illustrated, community-kept atlas of Monsters & Memories: a world map plus painted maps of its cities, wilds and dungeons, with markers for trainers, merchants, exits, camps and more.

**Live at [www.mnmatlas.com](https://www.mnmatlas.com/).**

MnM Atlas is an unofficial fan project and is not affiliated with the creators of Monsters & Memories.

## What it does

- Pan and zoom each map, switch between floors, and follow exits, stairs and lifts to the map they lead to.
- Search for places, NPCs, trainers, tradeskills and fish, and turn marker types on or off.
- Keep personal notes on any map. They stay in your browser unless you sign in, and you can export or import them.
- Sign in with Discord to suggest new markers, edits or moves, report problems and claim bounties from the Wanted board. Suggestions are reviewed before they reach the public map.
- Markers linked to the Monsters and Memories Wiki show that NPC's wiki card in their popup.
- Some dungeons have a relief view that shows how their floors stack.
- Every map has its own address (`/night-harbor/`, `/tel-ekir/?level=floor-2`), and any map can be embedded on another site. See [mnmatlas.com/embed](https://www.mnmatlas.com/embed/).

## Running it locally

The site is plain HTML, CSS and JavaScript with no build step or dependencies. You need Node 22 or newer for the scripts.

```sh
node scripts/make-share-pages.mjs   # builds the per-map pages, 404.html and the embed page
python3 -m http.server 8000         # or any static file server
```

Then open http://localhost:8000/. The generated pages are git-ignored.

A few things only work on the published site: the Wanted boards and NPC wiki cards are built during publishing with a wiki key kept as a repository secret, and Discord sign-in only redirects to addresses allowed in the account service.

Run the tests with:

```sh
node scripts/run-edit-review-tests.mjs
```

## How the data is laid out

- `data/maps.json` lists every map: its title, size, tile path, floors (`levels`), credit line and which marker and label files it uses.
- `data/<map-id>/markers.json` and `data/<map-id>/labels.json` hold each map's markers and place names. Night Harbor, the first map, still uses `data/markers.json`, `data/labels.json` and `data/hidden-areas.json` at the top level.
- `data/world/` also holds the zone outlines for the world map.
- `data/changelog.json` is the "What's new" list, newest first.
- `data/contributors.json` and `data/credits/<map-id>.json` record who contributed which published suggestions. They are written by the publishing job.
- `assets/tiles/<map>/` holds the map tiles, `assets/cards/<map-id>.jpg` the 1200×630 link preview for each map, and `assets/relief/` the relief view data.
- `config.js` holds the public settings for sign-in and visit stats. Leaving a value empty turns that feature off.

Adding a map means adding an entry to `data/maps.json`, its tiles, its marker and label files, and a card in `assets/cards/`. Publishing stops with an error if a map has no card.

## Suggestions and publishing

Signed-in visitors' suggestions, reports and synced notes are stored in a Supabase project (setup in [supabase/README.md](supabase/README.md)). Reviewers approve or reject them on the review desk inside the atlas.

Two GitHub workflows do the rest:

- **Apply approved suggestions** (`.github/workflows/apply-suggestions.yml`) runs every hour and after each push to `main`. It writes approved suggestions into the marker and label files, updates the contributor credits, commits to `main` and republishes the site. See [scripts/README.md](scripts/README.md).
- **Publish site** (`.github/workflows/pages.yml`) runs on every push to `main`: it builds the per-map pages, small map images, Wanted boards and NPC cards, then deploys to GitHub Pages.

Approved suggestions earn renown: 1 per suggestion, 2 per bounty and 3 per priority bounty.

## Credits

Many maps are drawn after community maps shared on the old Monsters and Memories wiki on Miraheze, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each map's credit line and source link is shown in the atlas and kept in `data/maps.json`.

| Map | After the work of |
| --- | --- |
| Night Harbor, Faelindral, Sungreet Strand, Shaded Dunes, Fallen Pass | Maggot |
| Underdocks | Keirvan |
| Ail'Vorith | Neeferio |
| Evershade Weald | Nindaan |
| Glass Flats, Scarwood, Keeper's Bight, Shallow Shoals | ElusiveGarden |
| Ancient Crypt | Doola |
| Infested Crypt | Doola, chazsolo |
| Wyrmsbane Tomb | Walabus, chazsolo, Hogs |
| Blacktide Bay, Tel Ekir | chazsolo |
| Grain Cellar | chazsolo, Itsjustprax |
| Vale of Zintar | Ganderdot |
| Caves of Irem | Naawa |
| Fallen Watch, Sunken Resort, Rothold | Skoop |
| Grimtide Sanctum | FeelingCaptive2973 |

The world map's zone connections follow the [Monsters and Memories Wiki](https://monstersandmemories.wiki/zones), used with the wiki's permission. NPC names, wiki links, Wanted lists and NPC cards are **Data from the Monsters and Memories Wiki**, linked back to each page.

Thanks to argus_q (passages and ambushes) and James-McMenamin (camping spots) for ideas and code, and to everyone who sends suggestions. Community contributors are listed in the atlas under **About this atlas**.

## Licences

- Map data and artwork adapted from the community maps above are shared under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), like their sources.
- Fonts: **IM Fell English** by Igino Marini and **Inter** by the Inter Project Authors, both under the SIL Open Font License 1.1 ([IM Fell English](assets/fonts/OFL-IMFellEnglish.txt), [Inter](assets/fonts/OFL-Inter.txt)).
- [Leaflet](https://leafletjs.com/) under the [BSD-2-Clause licence](assets/vendor/LEAFLET-LICENSE.txt), the [Supabase client](https://supabase.com/) under the [MIT licence](assets/vendor/SUPABASE-LICENSE.txt), and [three.js](https://threejs.org/) under the [MIT licence](assets/vendor/three/LICENSE).
