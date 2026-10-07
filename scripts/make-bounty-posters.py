"""The Wanted poster as the small still image of an NPC the atlas does not mark yet: for every NPC on a Wanted board
that no marker links to, mini/<wiki id>.webp is a copy of one generic poster (assets/bounty/wanted-poster.webp), so a
wiki page showing an NPC's mini map gets a poster asking for help instead of a missing picture. The poster links, like
every mini image, to ?find=<wiki id>, which opens the NPC's map on the Wanted board at its notice.

Run after make-mini-maps.py and make-bounties.mjs (GitHub does it when publishing); it only copies the file. It never
takes the place of a real mini map: an NPC a marker links to keeps its map picture, and once someone places it the next
publish draws that instead. Without the bounty lists it does nothing.

`python scripts/make-bounty-posters.py --draw` redraws the poster itself (Pillow, fontTools and brotli), in the Wanted
board's look: a pinned paper notice on the wood board.
"""
import io, json, re, shutil, sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'mini'
POSTER = ROOT / 'assets' / 'bounty' / 'wanted-poster.webp'
W, H = 320, 200
INK, RED, MUTED, BURNT = (36, 24, 13), (139, 44, 31), (90, 70, 48), (74, 44, 22)


@lru_cache(maxsize=None)
def font(woff2, size):
    from fontTools.ttLib import TTFont
    from PIL import ImageFont
    f = TTFont(str(ROOT / 'assets' / 'fonts' / woff2))
    f.flavor = None
    data = io.BytesIO()
    f.save(data)
    data.seek(0)
    return ImageFont.truetype(data, size)


def noise(x, y, seed):
    """Smooth value noise in [0, 1], the same idea as the map's parchment edge."""
    def h(i, j):
        n = (i * 374761393 + j * 668265263 + seed * 2147483647) & 0xffffffff
        n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
        return (n ^ (n >> 16)) / 0xffffffff
    xi, yi = int(x // 1), int(y // 1)
    fx, fy = x - xi, y - yi
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = h(xi, yi), h(xi + 1, yi), h(xi, yi + 1), h(xi + 1, yi + 1)
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy


def fbm(x, y, seed):
    return noise(x, y, seed) * 0.65 + noise(x * 2, y * 2, seed + 7) * 0.35


def tiled(path, size):
    from PIL import Image
    tile = Image.open(path).convert('RGB')
    out = Image.new('RGB', size)
    for y in range(0, size[1], tile.height):
        for x in range(0, size[0], tile.width):
            out.paste(tile, (x, y))
    return out


def board_and_paper():
    from PIL import Image, ImageFilter
    """The wood board with a paper notice on it: a ragged cut and a scorched band, as on the board's notices."""
    wood = tiled(ROOT / 'assets' / 'bounty' / 'wood.webp', (512, 512)).resize((W * 2, H * 2)).crop((0, 0, W, H))
    paper = tiled(ROOT / 'assets' / 'bounty' / 'paper.webp', (W, H))
    left, top, right, bottom = 22, 12, W - 22, H - 16
    shadow = Image.new('L', (W, H), 0)
    mask = Image.new('L', (W, H), 0)
    px, mx, sx = paper.load(), mask.load(), shadow.load()
    for y in range(H):
        for x in range(W):
            edge = min(x - left, y - top, right - x, bottom - y)
            cut = 1.5 + fbm(x / 6, y / 6, 71) * 5
            if edge + 3 >= cut:
                sx[x, y] = 120
            if edge < cut:
                continue
            mx[x, y] = 255
            burn = max(0.0, 1 - (edge - cut) / (6 + fbm(x / 9, y / 9, 29) * 6)) ** 1.6 * 0.85
            r, g, b = px[x, y]
            px[x, y] = (round(r + (BURNT[0] - r) * burn), round(g + (BURNT[1] - g) * burn), round(b + (BURNT[2] - b) * burn))
    # A soft shadow under the notice, offset down a little.
    shadow = shadow.filter(ImageFilter.GaussianBlur(4))
    dark = Image.new('RGB', (W, H), (10, 6, 3))
    wood = Image.composite(dark, wood, shadow.transform((W, H), Image.AFFINE, (1, 0, 0, 0, 1, -3)))
    wood.paste(paper, (0, 0), mask)
    return wood


def spaced(draw, xy, text, lettering, fill, spacing):
    """Small capitals with letter spacing, centred on xy."""
    widths = [draw.textlength(ch, font=lettering) for ch in text]
    x = xy[0] - (sum(widths) + spacing * (len(text) - 1)) / 2
    for ch, w in zip(text, widths):
        draw.text((x, xy[1]), ch, font=lettering, fill=fill)
        x += w + spacing


def draw():
    from PIL import ImageDraw
    image = board_and_paper()
    d = ImageDraw.Draw(image)
    d.ellipse([W / 2 - 5, 13, W / 2 + 5, 23], fill=(122, 85, 39), outline=(59, 38, 16))
    d.ellipse([W / 2 - 2.5, 15, W / 2 + 0.5, 18], fill=(227, 194, 127))
    spaced(d, (W / 2, 34), 'WANTED', font('im-fell-english-sc.woff2', 34), RED, 8)
    d.text((W / 2, 98), 'Not on the MnM Atlas yet', font=font('im-fell-english-regular.woff2', 22), fill=INK, anchor='mm')
    d.line([W / 2 - 70, 120, W / 2 + 70, 120], fill=(170, 140, 100), width=1)
    d.text((W / 2, 140), 'Claim the bounty: place it on the map', font=font('im-fell-english-italic.woff2', 15), fill=RED, anchor='mm')
    small = font('inter-variable.woff2', 9)
    credit = 'mnmatlas.com'
    cw = d.textlength(credit, font=small)
    d.rounded_rectangle([W - cw - 12, H - 15, W - 4, H - 3], radius=3, fill=(22, 18, 14))
    d.text((W - 8, H - 9), credit, font=small, fill=(201, 182, 150), anchor='rm')
    image.save(POSTER, 'WEBP', quality=80, method=6)
    print(f'Drew {POSTER.relative_to(ROOT)} ({POSTER.stat().st_size / 1024:.1f} KB)')


def main():
    if '--draw' in sys.argv:
        draw()
        return 0
    lists = sorted(p for p in (ROOT / 'bounties').glob('*.json') if p.name != 'index.json') if (ROOT / 'bounties').is_dir() else []
    if not lists or not POSTER.is_file():
        print('No bounty lists: no Wanted posters this time.')
        return 0
    registry = json.loads((ROOT / 'data' / 'maps.json').read_text(encoding='utf-8'))
    # NPCs a marker links to keep their real map picture.
    placed = set()
    for c in registry['maps']:
        for f in dict.fromkeys([c.get('markersFile')] + [l.get('markersFile') for l in c.get('levels', [])]):
            if f and (ROOT / f).is_file():
                for m in json.loads((ROOT / f).read_text(encoding='utf-8')):
                    if isinstance(m.get('wikiId'), str):
                        placed.add(m['wikiId'])
    OUT.mkdir(exist_ok=True)
    done = 0
    for path in lists:
        for row in json.loads(path.read_text(encoding='utf-8')).get('rows', []):
            wiki = row.get('id')
            if isinstance(wiki, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', wiki) and wiki not in placed and not (OUT / f'{wiki}.webp').exists():
                shutil.copyfile(POSTER, OUT / f'{wiki}.webp')
                done += 1
    print(f'Copied the Wanted poster for {done} NPCs not on the atlas yet to mini/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
