# MnMaps

An illustrated community atlas of Monsters & Memories, with Night Harbor and a local preview of Underdocks.

**[Browse the atlas](https://www.mnmatlas.com/)**

Drag to pan, scroll or pinch to zoom, and search the field guide for places, trainers and tradeskills. Select a result to visit it. Toggle place names or hidden areas independently; tap a dashed area or use the level buttons to bring a room or passage forward. Hidden outlines and guild locations are approximate.

Add personal notes to keep your own field guide: drag a new note into place, then show it as any marker type, an area label or a zone exit with an arrow. Notes stay in your browser. Use **Export notes** for a backup and **Import notes** to move them to another device. Existing notes remain available; **Export previous notes** keeps older-map notes available for repositioning.

Use **Copy link** in a popup or **Share this view** in the map toolbar. Links share a place or view without personal note text. The atlas also supports a compact layout in an iframe and a fullscreen button when permitted by the host page.

For example, link to `?map=night-harbor&place=wiki-4` or a view with `?map=night-harbor&x=1640&y=1015&z=5`.

Underdocks has **Lower docks** and **Upper city** levels. Use the level buttons to
keep the same view while switching. Lift popups offer **Go up** or **Go down**;
their positions and connections are approximate, to confirm in game. Personal
notes belong to the level where they were placed. Try
`?map=underdocks&level=lower`, `?map=underdocks&level=upper`, or
`?map=underdocks&level=lower&place=wiki-west-bank`.

Underdocks edition **v2** adds a parchment margin. Saved **v1** notes and alignment
drafts use the earlier positions and do not apply to v2; their browser storage is
retained, but they are not loaded on this edition. The supplied places already
use the updated positions.

Use **Edit positions** (✎) to drag markers, your notes and place names. **Done** saves the new positions in this browser and **Cancel** puts everything back; a moved marker or name can be reset to its published position. **Export moved positions** downloads them as a file.

Optional accounts and contributions
-----------------------------------

When accounts are enabled, **Sign in with Discord** lets you **Report a problem** with a published marker (what is wrong, plus optional details), suggest moved positions after **Done**, and **Share with everyone** from a personal note popup. Reports and suggestions wait for review; reports close as fixed or dismissed, and approved suggestions arrive in a later atlas update. Signed-in notes merge with this browser's notes and sync between devices; local notes remain available if the service is down. Optional sign-in stores your Discord name and id, suggestions, reports and synced notes. **Delete my account** in the field guide removes the sign-in and all of that data.

Public settings live in `config.js`; empty values disable their features. See [Supabase setup and access checks](supabase/README.md) and [publishing approved suggestions](scripts/README.md). To enable visit stats, set `goatcounter` to your GoatCounter site code (just the code, not a URL). Counts are anonymous, use no cookies, and record map/level visits and named actions without search text, note text or coordinates. Localhost visits are skipped. Only the optional counter script is loaded remotely, from `gc.zgo.at`; it uses [GoatCounter's manual count API](https://www.goatcounter.com/help/js).

Credits and licences
--------------------

Faelindral opens on Platforms, with Ground available from the level buttons.
Simplified view: platform layout, distances and heights are approximate.
The Platforms button, map subtitle, parchment note, field guide and About
identify this simplified view. Ground retains its existing presentation.
The two charts use different layouts: switching views fits the destination;
landing arrows open the matching landing. Platforms includes community place
names, guild badges, amenities, tradeskills, notable NPCs and district vendor
lists. Temple Lift's upper landing is unconfirmed, so it has no switch arrow.
There are no platform hover outlines or dotted cutouts.

The Platforms artwork is adapted from
[Maggot's Faelindral map](https://monstersandmemories.miraheze.org/wiki/File:Faelindral_V2.jpg)
and licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Its forest background and ground bridge are omitted, and the raised deck restored.
The licences for the other artwork and site remain unchanged.

Faelindral place names, guilds, amenities and tradeskill locations are adapted
from [Maggot's Faelindral wiki map](https://monstersandmemories.miraheze.org/wiki/File:Faelindral_V2.jpg)
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The adapted datasets carry the same licence. Locations and platform names are
approximate; ARC/FTR is shown as ARC/WAR. Marker and label positions can be
adjusted with `?align=1` and exported for review.

Underdocks place names and locations are adapted from [Keirvan's bottom floor wiki map](https://monstersandmemories.miraheze.org/wiki/File:UnderdocksBottomFloorCity.png)
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Locations are approximate; positions are adjusted to this map and abbreviations expanded.

Place names and guild locations adapted from [Maggot's Night Harbor map](https://static.wikitide.net/monstersandmemorieswiki/5/5a/Night_harbor_V5.jpg) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)); positions adjusted to this map, 'Docs' corrected to 'Docks'. The adapted place-name and guild dataset in `data/labels.json` carries the same licence.

Fonts are bundled locally: **IM Fell English** (regular, italic and small caps) by Igino Marini and **Inter** by the Inter Project Authors, under the SIL Open Font License 1.1. See [IM Fell English OFL](assets/fonts/OFL-IMFellEnglish.txt) and [Inter OFL](assets/fonts/OFL-Inter.txt).

Map controls use [Leaflet](https://leafletjs.com/), included under its [BSD-2-Clause licence](assets/vendor/LEAFLET-LICENSE.txt).

Optional accounts use the locally bundled [Supabase client](https://supabase.com/), under its [MIT licence](assets/vendor/SUPABASE-LICENSE.txt).

MnMaps is an unofficial fan project and is not affiliated with the creators of Monsters & Memories.
