# MnM Atlas

An illustrated community atlas of Monsters & Memories: city, wilderness and dungeon maps, plus a world map.

**[Browse the atlas](https://www.mnmatlas.com/)**

Drag to pan, scroll or pinch to zoom, and use the search menu to find places, trainers and tradeskills. Select a result to visit it. Toggle place names or hidden areas independently; tap a dashed area or use the level buttons to bring a room or passage forward. Hidden outlines and guild locations are approximate.

Add personal notes to keep your own map notes: drag a new note into place, then show it as any marker type, an area label or a zone exit with an arrow. Notes stay in your browser. Use **Export notes** for a backup and **Import notes** to move them to another device. Existing notes remain available; **Export previous notes** keeps older-map notes available for repositioning.

A marker can link to its page on a wiki: fill **Wiki page** when you add a note or **Suggest an edit** to a published marker, and its popup shows a **Read on …** link that opens in a new tab. Signed-in visitors get suggestions from the Monsters and Memories Wiki as they type in the **Name** field; picking one fills in the empty fields only: name and level, the marker type (a trainer's class comes from the wiki's tags), the wiki page and its short location line as the note. **Also suggest this for the public map** sends the new note for review in the same step, and later moves or edits of the note follow the pending suggestion. Links must point to a page on one of the sites listed in `wiki-links.js` (the Monsters and Memories Wiki, the old community wiki on Miraheze, or Petrichor's database); other addresses are refused. When the atlas is embedded, `wiki-links.js` also decides what happens to a link on the host page: each listed host shows all links, only links to its own site, or none, and may adapt another site's link to a page of its own. Embeds on hosts not listed show no wiki links, so the atlas never sends a site's readers to a different wiki.

A marker linked to an NPC page on the Monsters and Memories Wiki shows that NPC's wiki card in its popup: its tags, level, race and class, location, up to five notable loot items (with drop rates once the wiki has them) and the wiki's short summary, all on one band and each linking back to the wiki, with its credit. The atlas's own note follows under **Atlas note**. The cards are built when the site is published (`scripts/make-npc-cards.mjs` writes `npc-cards/<map-id>.json`, not kept in the repo), never per visitor, and the wiki's full description is never copied. Popup actions (Copy link, Suggest an edit, Report a problem, and Edit, Delete and Share on your own notes) are buttons at the foot of every popup.

The **Wanted** board (the banner at the top of the search menu) lists the NPCs the wiki files under the map's zone that the map does not mark yet, in tabs (trainers, merchants, quest givers, named NPCs); class trainers and merchants are priority bounties. Drag a notice onto the map, or press **Take the bounty**, to place it: the name, type and wiki page come from the wiki and stay fixed, and only the notes and position can be changed. A claimed bounty is always sent for review and shared on the public map, one claim per NPC; it shows as claimed at once. Signed out, **Sign in to claim** sends the claim right after sign-in, or **Save as a private note** keeps it on this device (it is offered for claiming at a later sign-in). Deleting the note withdraws a claim or suggestion that is still waiting for review. Approved suggestions earn renown: 1 per suggestion, 2 per bounty, 3 per priority bounty. The lists are built when the site is published (`scripts/make-bounties.mjs` writes `bounties/<map-id>.json`, not kept in the repo); both builders need the `WIKI_API_KEY` repository secret and are skipped without it. An NPC on a Wanted board that no marker links to yet gets the Wanted poster as its small still image (`/mini/<wiki id>.webp`), linking to its notice on the board, until it is placed.

**Show on map** in the search menu turns marker types on and off, with **Hide all** / **Show all**; the eye in the map toolbar hides or shows every marker at once.

Vendor notes keep one **Kind** (such as Leatherworking vendor) and optional **Sells** tags: Ammo, Armor, Bags, Food & drink, Jewelry, Materials, Mount gear, Quest items, Recipes, Shields, Spell scrolls and Weapons. Choose several tags in the note form; reviewers can change them before approval. The **Vendors** filter offers kinds, groups and **Sells** item types, and search includes the tags. Tags stay with backups and suggestions. Shady merchant is a Vendor kind in General goods, using the Vendor icon and colour; older Shady merchant notes and suggestions are read as that kind. Older trade supplies kinds still work as trade vendor kinds. The wiki's NPC lookup does not say what a merchant sells, so tags are chosen by hand.

Use **Copy link** in a popup or **Share this view** in the map toolbar. Links share a place or view without personal note text. The atlas also supports a compact layout in an iframe and a fullscreen button when permitted by the host page.

To put one map on a wiki page or website, use **Embed** in the header: it writes an iframe for `/<map-id>/?embed=map`, optionally at the current level and selected place. That view shows the one map with its levels, without the map picker, search menu or editing; exits and the **Open in MnM Atlas** button open the full atlas in a new tab, and the scroll wheel only zooms after the map is clicked. `?embed=1` keeps the compact full atlas with its map picker. Every embed option (map embeds, small map images, `?find=` links, address options and the map list) is described for site owners at [mnmatlas.com/embed/](https://www.mnmatlas.com/embed/), built from `templates/embed.html` by `scripts/make-share-pages.mjs`.

Each map has its own address, such as `mnmatlas.com/night-harbor/`. For example, link to `/night-harbor/?place=wiki-4` or a view with `/night-harbor/?x=1640&y=1015&z=5`. Choosing another map, following an exit or switching levels updates the address, and **Back** returns to the previous one. Older `?map=night-harbor` links still open and switch to the new address.

Underdocks has **Lower docks** and **Upper city** levels. Use the level buttons to
keep the same view while switching. Lift popups offer **Go up** or **Go down**;
their positions and connections are approximate, to confirm in game. Personal
notes belong to the level where they were placed. Try
`/underdocks/?level=lower`, `/underdocks/?level=upper`, or
`/underdocks/?level=lower&place=wiki-west-bank`.

Underdocks edition **v2** adds a parchment margin. Saved **v1** notes and alignment
drafts use the earlier positions and do not apply to v2; their browser storage is
retained, but they are not loaded on this edition. The supplied places already
use the updated positions.

Use **Edit** (✎) to drag markers, your notes and place names, and to change their names and descriptions (your notes at once, published ones through **Suggest an edit**). **Done** saves the new positions in this browser and **Cancel** puts everything back; a moved marker or name can be reset to its published position. **Export moved positions** downloads them as a file.

Optional accounts and contributions
-----------------------------------

When accounts are enabled, **Sign in** in the top bar (Discord) lets you **Report a problem** with a published marker (what is wrong, plus optional details), **Suggest an edit** to the name or description of a published marker or place name, suggest moved positions after **Done**, and **Share with everyone** from a personal note popup, or claim **Wanted** bounties. Reports and suggestions wait for review (deleting the note withdraws a suggestion still waiting); reports close as fixed or dismissed, and approved suggestions arrive in a later atlas update. Signed-in notes merge with this browser's notes and sync between devices; local notes remain available if the service is down. Optional sign-in stores your Discord name and id, suggestions, reports and synced notes. **Delete my account** in the account menu (your avatar in the top bar) removes the sign-in and all of that data.

**Copy link** and **Share this view** hand out the map's own address. Each `<map-id>/index.html` is the full atlas page with that map's title and link preview card (`assets/cards/<map-id>.jpg`, 1200×630); these pages and `404.html` (which opens a map whose name was typed in another case) are built from `index.html` by `scripts/make-share-pages.mjs` and are not kept in the repo. GitHub runs it on every push to `main` and publishes the result (`.github/workflows/pages.yml`; Pages source: GitHub Actions). Run `node scripts/make-share-pages.mjs` locally to preview the map addresses. A new map needs its card, or publishing stops with an error and the current site stays up.

Public settings live in `config.js`; empty values disable their features. See [Supabase setup and access checks](supabase/README.md) and [publishing approved suggestions](scripts/README.md). To enable visit stats, set `goatcounter` to your GoatCounter site code (just the code, not a URL). Counts are anonymous, use no cookies, and record map/level visits and named actions without search text, note text or coordinates. Localhost visits are skipped. Only the optional counter script is loaded remotely, from `gc.zgo.at`; it uses [GoatCounter's manual count API](https://www.goatcounter.com/help/js).

Credits and licences
--------------------

Faelindral shows the city's platforms in a simplified view: platform layout,
distances and heights are approximate. Its forest floor is the Evershade Weald
map: every lift and stairway on either map links to the matching landing on the
other. Temple Lift's lower landing is unconfirmed, so it has no link.

The Platforms artwork is adapted from
[Maggot's Faelindral map](https://monstersandmemories.miraheze.org/wiki/File:Faelindral_V2.jpg)
and licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Its forest background and ground bridge are omitted, and the raised deck restored.
The licences for the other artwork and site remain unchanged.

Faelindral place names, guilds, amenities and tradeskill locations are adapted
from [Maggot's Faelindral wiki map](https://monstersandmemories.miraheze.org/wiki/File:Faelindral_V2.jpg)
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The adapted datasets carry the same licence. Locations and platform names are
approximate.

Evershade Weald place names, caves, creature camps and exits are adapted from
[Nindaan's Evershade Weald wiki map](https://monstersandmemories.miraheze.org/wiki/File:Evershade_Weald_june_26.jpg)
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); the adapted
dataset carries the same licence. Locations are approximate.

Underdocks place names and locations are adapted from [Keirvan's bottom floor wiki map](https://monstersandmemories.miraheze.org/wiki/File:UnderdocksBottomFloorCity.png)
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Locations are approximate; positions are adjusted to this map and abbreviations expanded.

Place names and guild locations adapted from [Maggot's Night Harbor map](https://static.wikitide.net/monstersandmemorieswiki/5/5a/Night_harbor_V5.jpg) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)); positions adjusted to this map, 'Docs' corrected to 'Docks'. The adapted place-name and guild dataset in `data/labels.json` carries the same licence.

Fonts are bundled locally: **IM Fell English** (regular, italic and small caps) by Igino Marini and **Inter** by the Inter Project Authors, under the SIL Open Font License 1.1. See [IM Fell English OFL](assets/fonts/OFL-IMFellEnglish.txt) and [Inter OFL](assets/fonts/OFL-Inter.txt).

NPC names, wiki links, the Wanted lists and the NPC cards come from the [Monsters and Memories Wiki](https://monstersandmemories.wiki/) through its partner API, credited and linked back to each page as the wiki asks. The bounty board's paper and wood textures are original to this atlas.

Map controls use [Leaflet](https://leafletjs.com/), included under its [BSD-2-Clause licence](assets/vendor/LEAFLET-LICENSE.txt).

Optional accounts use the locally bundled [Supabase client](https://supabase.com/), under its [MIT licence](assets/vendor/SUPABASE-LICENSE.txt).

MnM Atlas is an unofficial fan project and is not affiliated with the creators of Monsters & Memories.
