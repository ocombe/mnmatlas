"""Small still images of the map around every marker, for wiki pages that link to the atlas without an iframe:
mini/<map id>/<place id>.webp, and mini/<wiki id>.webp for markers that carry a wiki id; 320 x 200.

Run after make-share-pages.mjs (GitHub does it when publishing); the images are not kept in the repository.
Needs Pillow, fontTools and brotli (pip install pillow fonttools brotli).
"""
import io, json, math, re, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'mini'
W, H, TILE = 320, 200, 256
CREAM, INK, BORDER = (243, 226, 194), (22, 18, 14), (245, 226, 180)


def font(woff2, size):
    """The site's own lettering (woff2) as a font Pillow can draw with."""
    f = TTFont(str(ROOT / 'assets' / 'fonts' / woff2))
    f.flavor = None
    data = io.BytesIO()
    f.save(data)
    data.seek(0)
    return ImageFont.truetype(data, size)


def categories():
    """Marker colours as the site draws them: the built-in types, then each map's extra ones."""
    app = (ROOT / 'app.js').read_text(encoding='utf-8')
    colours = {}
    for name in ('baseCategories', 'noteCategories'):
        body = re.search(r'const ' + name + r'=\{(.*?)\};', app).group(1)
        for key, hexa in re.findall(r"'([^']+)':\['[^']*','(#[0-9a-fA-F]{6})'\]", body):
            colours[key] = hexa
    return colours


def rgb(hexa):
    return tuple(int(hexa[i:i + 2], 16) for i in (1, 3, 5))


def tiles_crop(pattern, z, left, top, fill):
    """The window [left, top, left+W, top+H] at zoom z, cut from the map's tiles (missing tiles stay parchment)."""
    image = Image.new('RGB', (W, H), fill)
    for ty in range(math.floor(top / TILE), math.floor((top + H - 1) / TILE) + 1):
        for tx in range(math.floor(left / TILE), math.floor((left + W - 1) / TILE) + 1):
            path = ROOT / pattern.replace('{z}', str(z)).replace('{x}', str(tx)).replace('{y}', str(ty))
            if tx < 0 or ty < 0 or not path.exists():
                continue
            with Image.open(path) as tile:
                image.paste(tile.convert('RGB'), (tx * TILE - left, ty * TILE - top))
    return image


def draw_pin(draw, x, y, colour):
    """The site's pin: a teardrop in the marker's colour with a cream rim, its point on the spot."""
    r = 11
    cx, cy = x, y - 17
    draw.polygon([(cx - r * 0.72, cy + r * 0.72), (x, y), (cx + r * 0.72, cy + r * 0.72)], fill=BORDER)
    draw.ellipse([cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1], fill=BORDER)
    draw.polygon([(cx - r * 0.6, cy + r * 0.6), (x, y - 3), (cx + r * 0.6, cy + r * 0.6)], fill=colour)
    draw.ellipse([cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 1], fill=colour)
    draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=CREAM)


def draw_chip(draw, x, y, label, lettering):
    """A class trainer is a dark chip with its classes (ARC · FTR · RNG) on a short leader line."""
    w = draw.textlength(label, font=lettering) + 14
    draw.line([(x, y), (x, y - 9)], fill=BORDER, width=2)
    draw.rounded_rectangle([x - w / 2, y - 31, x + w / 2, y - 9], radius=4, fill=(52, 46, 64), outline=BORDER, width=1)
    draw.text((x, y - 20), label, font=lettering, fill=CREAM, anchor='mm')


def title_of(m):
    """What the site calls the marker: a trainer by its class first, then the name underneath."""
    classes = [c for c in m.get('classes') or [] if isinstance(c, str) and c.strip()] if m.get('category') == 'Class trainer' else []
    squash = lambda v: re.sub(r'[^a-z]', '', v.lower())
    if not classes or all(squash(c) in squash(m['name']) for c in classes):
        return m['name'], ''
    title = ' / '.join(classes) + (' trainers' if len(classes) > 1 else ' trainer')
    who = '' if re.fullmatch(r'[A-Z]{2,4}(\s*[/·,]\s*[A-Z]{2,4})*', m['name'].strip()) else m['name']
    return title, who


def fit(draw, text, lettering, width):
    while text and draw.textlength(text, font=lettering) > width:
        text = text[:-2].rstrip() + '…'
    return text


def main():
    registry = json.loads((ROOT / 'data' / 'maps.json').read_text(encoding='utf-8'))
    colours = categories()
    heading, italic, small = font('im-fell-english-regular.woff2', 17), font('im-fell-english-italic.woff2', 12), font('inter-variable.woff2', 9)
    chip = font('inter-variable.woff2', 10)
    done, sizes, seen = 0, 0, set()
    for c in registry['maps']:
        files = list(dict.fromkeys([c.get('markersFile')] + [l.get('markersFile') for l in c.get('levels', []) if l.get('markersFile')]))
        label_files = list(dict.fromkeys([c.get('labelsFile')] + [l.get('labelsFile') for l in c.get('levels', []) if l.get('labelsFile')]))
        chips = {}
        for f in filter(None, label_files):
            for t in json.loads((ROOT / f).read_text(encoding='utf-8')).get('trainers', []):
                chips[t.get('id')] = ' · '.join(t.get('abbreviations') or [])
        extra = {k: v[1] for k, v in (c.get('extraCategories') or {}).items()}
        levels = {l['id']: l for l in c.get('levels', [])}
        for f in filter(None, files):
            for m in json.loads((ROOT / f).read_text(encoding='utf-8')):
                wiki = m.get('wikiId') if isinstance(m.get('wikiId'), str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', m.get('wikiId')) else None
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', str(m.get('id', ''))) or m.get('id', '').startswith('personal-') or not m.get('name'):
                    continue
                level = levels.get(m.get('level')) or levels.get(c.get('defaultLevel')) or {}
                cfg = {**c, **{k: v for k, v in level.items() if k in ('tilePath', 'width', 'height', 'maxNativeZoom', 'coordinateZoom')}}
                # The same closeness a visitor gets when the atlas opens on the place.
                z = max(cfg['coordinateZoom'] - 1, min(cfg['maxNativeZoom'], round(c['defaultView']['placeZoom'])))
                scale = 2 ** (z - cfg['coordinateZoom'])
                px, py = m['x'] * scale, m['y'] * scale
                mw, mh = cfg['width'] * scale, cfg['height'] * scale
                left = int(min(max(px - W / 2, 0), max(mw - W, 0)))
                top = int(min(max(py - H * 0.58, 0), max(mh - H, 0)))
                image = tiles_crop(cfg['tilePath'], z, left, top, (214, 196, 160))
                draw = ImageDraw.Draw(image)
                spot = (px - left, py - top)
                if m.get('category') == 'Class trainer' and chips.get(m['id']):
                    draw_chip(draw, *spot, chips[m['id']], chip)
                else:
                    draw_pin(draw, *spot, rgb(m.get('color') or extra.get(m.get('category')) or colours.get(m.get('category'), '#365f59')))
                # The caption plate, like the site's: the name, then who it is for a trainer and the zone (and level).
                title, who = title_of(m)
                where = c['title'] + (' · ' + level['title'] if c.get('levels') and level.get('title') else '')
                who = ' · '.join(filter(None, [who, where]))
                title = fit(draw, title, heading, W - 30)
                who = fit(draw, who, italic, W - 30) if who else ''
                plate_h = 26 + (15 if who else 0)
                plate_w = max(draw.textlength(title, font=heading), draw.textlength(who, font=italic) if who else 0) + 16
                plate = Image.new('RGBA', (W, H), (0, 0, 0, 0))
                ImageDraw.Draw(plate).rounded_rectangle([6, H - 6 - plate_h, 6 + plate_w, H - 6], radius=6, fill=INK + (225,), outline=(110, 86, 52, 255))
                image = Image.alpha_composite(image.convert('RGBA'), plate).convert('RGB')
                draw = ImageDraw.Draw(image)
                draw.text((14, H - 6 - plate_h + 4), title, font=heading, fill=CREAM)
                if who:
                    draw.text((14, H - 6 - plate_h + 23), who, font=italic, fill=(201, 182, 150))
                credit = 'mnmatlas.com'
                cw = draw.textlength(credit, font=small)
                draw.rounded_rectangle([W - cw - 12, H - 17, W - 4, H - 4], radius=3, fill=INK)
                draw.text((W - 8, H - 10.5), credit, font=small, fill=(201, 182, 150), anchor='rm')
                data = io.BytesIO()
                image.save(data, 'WEBP', quality=72, method=6)
                for path in ([OUT / f'{wiki}.webp'] if wiki and wiki not in seen else []) + [OUT / c['id'] / f"{m['id']}.webp"]:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data.getvalue())
                    sizes += len(data.getvalue())
                seen.add(wiki)
                done += 1
    print(f'Wrote {done} mini maps ({sizes / 1024:.0f} KB with both addresses) to mini/')


if __name__ == '__main__':
    sys.exit(main())
