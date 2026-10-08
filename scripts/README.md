# Publish approved suggestions

## On GitHub

The **Apply approved suggestions** workflow (`.github/workflows/apply-suggestions.yml`) does this for you: it applies every approved suggestion, saves the data changes to `main` and publishes the site. It runs once a day and whenever you choose **Run workflow** in the repository's Actions tab; tick the dry-run box to only check the approved suggestions. It needs the service key as the `SUPABASE_SERVICE_KEY` repository secret (Settings → Secrets and variables → Actions). If a run fails after writing data, the written data is still saved, and running it again finishes the batch. Do not run the local publisher at the same time.

## Locally

Requires Node 18 or newer, with no dependencies. Run from any directory; data paths are resolved from the script's atlas folder. First review suggestions in the atlas, then supply the project URL and service key **only in your local environment**. Never save the service key in `config.js`, a site file, or git.

PowerShell:

```powershell
$env:SUPABASE_URL='https://<project-ref>.supabase.co'
$env:SUPABASE_SERVICE_KEY='<service key>'
node scripts/apply-approved.mjs --dry-run
node scripts/apply-approved.mjs
Remove-Item Env:SUPABASE_SERVICE_KEY
```

POSIX shell:

```sh
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/apply-approved.mjs --dry-run
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/apply-approved.mjs
```

The dry run validates every approved row and prints the proposed summary without changing files or backend rows. A normal run applies approved suggestions oldest first, selecting `markersFile` or `labelsFile` from `data/maps.json`, including level overrides. Coordinates round to integers. New IDs are `community-<suggestion id>`; area labels and exits go to the place-name file. Only supported marker fields are copied. A wiki link is copied only when it is a page on a site listed in `wiki-links.js`; anything else sends the suggestion back to review. An edit that carries a link sets it, or removes it when empty, and its conflict check includes the link the visitor saw. A link picked from the wiki search also carries the wiki's id for that entry (`wikiId`, a short plain string; anything else goes back to review); it is kept with the link, and dropped when the link is removed or replaced without one. Trade symbols and colours work on published markers too.

The script preserves each JSON file's indentation, line endings and trailing newline. It validates the complete batch before writing, then sets applied suggestions to `published`. Re-running after a failed status update recognizes existing IDs and positions. A move whose published starting point has changed stops the run: review that suggestion again before applying it. Two different approved moves for the same target may therefore require another review. Do not run two publishers concurrently.

Review the resulting data diff and preview the atlas before committing and pushing to `main`, which publishes the site. The script does not commit or deploy, and never prints the service key. If files were written but a backend update failed, keep those files and rerun before accepting newer suggestions.

Run `node scripts/test-apply-approved.mjs` for local publisher checks against a mock service; it uses disposable fixture files inside this folder and leaves map data unchanged.

Run `node scripts/test-community.mjs` for client checks with a local service stub, including disabled configuration, counters, problem reports, suggestions and note sync. These do not replace the live access checks in the Supabase setup guide.

## Wiki reconcile

`node scripts/wiki-reconcile.mjs <map-id>` compares one map's NPC markers (Named mob, Notable NPC, Vendor (including the Shady merchant kind), Class trainer, Quest, Mob camp; a class trainer only matches its exact name, so one named after its class is left alone) and place names with the wiki's NPCs in that map's zone (its title, or `wikiZone` in `data/maps.json`), through the wiki's partner API. It writes `<map-id>.md` (to read) and `<map-id>.json` (to approve) to `../tools/wiki-reconcile/`, outside the repository, and keeps answers in a cache there; new lookups are paced at one a second. Exact matches are pre-approved, close and ambiguous ones are not. `node scripts/wiki-reconcile.mjs --apply <map-id> [--dry-run]` then applies the approved rows: the wiki's name, link and id on markers, and approved place names become markers (same id, position, level and note). Only names, ids and page addresses are taken from the wiki. The key is read from `WIKI_API_KEY` or `../secrets/wiki-api-key.txt` and is never printed. `node scripts/test-wiki-reconcile.mjs` checks the matching and applying offline.

## Find links

`make-share-pages.mjs` also writes `data/find-index.json` (not kept in the repo): every marker and place name of every map with its level, wiki id and trainer classes. `?find=<text>` on any atlas page looks it up (`find.js`): a wiki id first, then the exact name (a class trainer also answers to "<class> trainer"), then names containing the text; `&map=<id>` keeps to one map. One match opens its map on that place; several, or none, open the Search menu with the text and the matches on other maps. `?wiki=<wiki id>` works the same way. Run `node scripts/test-find.mjs` for the matching checks.

## Mini map images

`python scripts/make-mini-maps.py` (after `make-share-pages.mjs`; needs `pip install pillow fonttools brotli`) cuts a 320 × 200 still image of the map around every marker, with its pin or class chip and its name, from the map tiles: `mini/<map id>/<place id>.webp`, and `mini/<wiki id>.webp` for markers with a wiki id. GitHub builds them when publishing (`.github/workflows/pages.yml`); they are not kept in the repository. The Embed dialog offers the HTML for one: an image that links to the atlas, with no iframe or script.

## Wanted lists and NPC cards

Both are built by GitHub when publishing (`.github/workflows/pages.yml`), with the wiki's partner key as the `WIKI_API_KEY` repository secret; without it, or if the wiki fails, they are skipped and the publish goes on. Locally the key is read from `../secrets/wiki-api-key.txt`. Neither is kept in the repository.

- `node scripts/make-bounties.mjs` writes `bounties/<map-id>.json` for every zone map: the zone's NPCs from the wiki (one request per zone), without plain mobs, kinds of creature ("A Deepcut arsonist"), NPCs the map already marks by wiki id or name, and instructors whose classes all have a class trainer marker or trainer chip on the map. A trainer's class comes from the wiki's class field or tags, else its name; a trainer with none there gets one page lookup. Trainers and merchants are priority bounties. Only ids, names, roles, levels, trainer classes and page addresses are kept.
- `python scripts/make-bounty-posters.py` (after the mini maps and the bounty lists) copies the one generic Wanted poster (`assets/bounty/wanted-poster.webp`, 320 × 200; `--draw` redraws it) to `mini/<wiki id>.webp` for every bounty NPC no marker links to yet, so the small still image of an NPC the atlas does not mark asks for help instead of missing. `make-bounties.mjs` also writes `bounties/index.json` (wiki id, name, map), and `?find=` / `?wiki=` fall back to it: one match opens that map's Wanted board at the notice.
- `node scripts/make-npc-cards.mjs` writes `npc-cards/<map-id>.json`: for every marker linked to a wiki NPC, its tags, level, race, class, location line, short summary and first five loot items (likeliest first) with their pages and the loot count, never the full description. Cards the live atlas already has and that are less than a day old are kept, so a publish only asks the wiki about newly linked NPCs and cards due for a refresh, about 85 a minute at most (`CARDS_FROM=<site>` reads the previous cards from another address, for testing).

`node scripts/test-find.mjs` also checks trainer classes from tags and chips, and what a card keeps.
