"""Wanted posters as the small still images of NPCs the atlas does not mark yet: mini/<wiki id>.webp, 320 x 200, in
the Wanted board's look (a pinned paper notice on wood), so a wiki page showing an NPC's mini map gets a poster asking
for help instead of a missing picture. The poster links (like every mini image) to ?find=<wiki id>, which opens the
NPC's map on the Wanted board at its notice.

Run after make-mini-maps.py and make-bounties.mjs (GitHub does it when publishing). It reads bounties/<map id>.json and
never takes the place of a real mini map: an NPC that a marker links to keeps its map picture, and once someone places
it, the next publish draws that instead. Without the bounty lists it does nothing. Needs Pillow, fontTools and brotli.
"""
import io, json, re, sys
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'mini'
W, H = 320, 200
INK, RED, MUTED, BURNT = (36, 24, 13), (139, 44, 31), (90, 70, 48), (74, 44, 22)


@lru_cache(maxsize=None)
def font(woff2, size):
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
    tile = Image.open(path).convert('RGB')
    out = Image.new('RGB', size)
    for y in range(0, size[1], tile.height):
        for x in range(0, size[0], tile.width):
            out.paste(tile, (x, y))
    return out


def board_and_paper():
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
    from PIL import ImageFilter
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


def fit_name(draw, name, width):
    """The name as large as it fits, on one line, else on two."""
    for size in (26, 24, 22, 20, 18):
        f = font('im-fell-english-regular.woff2', size)
        if draw.textlength(name, font=f) <= width:
            return f, [name]
    f = font('im-fell-english-regular.woff2', 18)
    words, lines = name.split(), ['']
    for w in words:
        trial = (lines[-1] + ' ' + w).strip()
        if draw.textlength(trial, font=f) <= width or not lines[-1]:
            lines[-1] = trial
        else:
            lines.append(w)
    lines = lines[:2]
    while draw.textlength(lines[-1], font=f) > width:
        lines[-1] = lines[-1][:-2].rstrip() + '…'
    return f, lines


def classes_known():
    text = (ROOT / 'wiki-links.js').read_text(encoding='utf-8')
    block = re.search(r'const classAbbreviations=\{([^}]*)\}', text).group(1)
    return [re.sub(r"^'|'$", '', k) for k in re.findall(r"('?[A-Za-z][A-Za-z ]*'?):'[A-Z]{3}'", block)]


def kind(row, classes):
    name = str(row.get('name', ''))
    given = [c for c in row.get('classes', []) if c in classes] if isinstance(row.get('classes'), list) else []
    trainer = given or row.get('role') == 'trainer' or re.search(r'\b(instructors?|trainers?|guild\s*masters?|guildmasters?)\b', name, re.I)
    if trainer:
        if not given and re.search(r'\b(instructors?|trainers?|guild\s*masters?|guildmasters?)\b', name, re.I):
            given = [c for c in classes if re.search(r'\b' + c.replace(' ', r'\s*') + r's?\b', name, re.I)]
        return 'Class trainer' + (' · ' + ' / '.join(given) if given else '')
    return {'merchant': 'Merchant', 'quest': 'Quest giver'}.get(row.get('role'), 'Named')


def level_text(level):
    v = str(level or '').strip()
    return ('Levels ' + re.sub(r'\s*[-–]\s*', '–', v)) if re.search(r'[-–]', v) else ('Level ' + v if v else '')


def poster(row, zone, classes, base, fonts):
    image = base.copy()
    draw = ImageDraw.Draw(image)
    sc, meta, italic, small = fonts
    # The nail.
    draw.ellipse([W / 2 - 5, 13, W / 2 + 5, 23], fill=(122, 85, 39), outline=(59, 38, 16))
    draw.ellipse([W / 2 - 2.5, 15, W / 2 + 0.5, 18], fill=(227, 194, 127))
    spaced(draw, (W / 2, 30), 'WANTED', sc, RED, 5)
    name_font, lines = fit_name(draw, row['name'], W - 76)
    # Under WANTED: one line of name, or two a little smaller, then the facts below whichever it is.
    y = 70 if len(lines) == 1 else 66
    for i, line in enumerate(lines):
        draw.text((W / 2, y + i * (name_font.size + 1)), line, font=name_font, fill=INK, anchor='mm')
    y += (len(lines) - 1) * (name_font.size + 1) + name_font.size / 2 + 11
    facts = ' · '.join(x for x in [level_text(row.get('level')), kind(row, classes)] if x)
    while draw.textlength(facts, font=meta) > W - 70:
        facts = facts[:-2].rstrip() + '…'
    draw.text((W / 2, y), facts, font=meta, fill=MUTED, anchor='mm')
    draw.text((W / 2, y + 17), zone, font=italic, fill=MUTED, anchor='mm')
    draw.line([W / 2 - 60, H - 52, W / 2 + 60, H - 52], fill=(170, 140, 100), width=1)
    draw.text((W / 2, H - 38), 'Not on the atlas yet. Help place it.', font=italic, fill=RED, anchor='mm')
    credit = 'mnmatlas.com'
    cw = draw.textlength(credit, font=small)
    draw.rounded_rectangle([W - cw - 12, H - 15, W - 4, H - 3], radius=3, fill=(22, 18, 14))
    draw.text((W - 8, H - 9), credit, font=small, fill=(201, 182, 150), anchor='rm')
    data = io.BytesIO()
    image.save(data, 'WEBP', quality=74, method=6)
    return data.getvalue()


def main():
    lists = sorted((ROOT / 'bounties').glob('*.json')) if (ROOT / 'bounties').is_dir() else []
    lists = [p for p in lists if p.name != 'index.json']
    if not lists:
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
    classes = classes_known()
    base = board_and_paper()
    fonts = (font('im-fell-english-sc.woff2', 17), font('inter-variable.woff2', 11), font('im-fell-english-italic.woff2', 13), font('inter-variable.woff2', 9))
    done, sizes, seen = 0, 0, set()
    OUT.mkdir(exist_ok=True)
    for path in lists:
        body = json.loads(path.read_text(encoding='utf-8'))
        zone = str(body.get('zone') or '')
        for row in body.get('rows', []):
            wiki = row.get('id')
            if not isinstance(wiki, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', wiki) or wiki in placed or wiki in seen or not row.get('name'):
                continue
            data = poster(row, zone, classes, base, fonts)
            (OUT / f'{wiki}.webp').write_bytes(data)
            seen.add(wiki)
            done += 1
            sizes += len(data)
    print(f'Wrote {done} Wanted posters ({sizes / 1024:.0f} KB) to mini/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
