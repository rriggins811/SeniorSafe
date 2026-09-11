"""Regenerate the Android launcher icons from the Hammock365 evergreen brand icon.

Legacy icons (ic_launcher, ic_launcher_round) come from icon-1024.png (rounded
evergreen square with the hammock mark). The adaptive foreground comes from
mark-transparent-1024.png centered in the 66/108 safe zone, with the adaptive
background color set to the same evergreen so the two agree.

Usage: python3 scripts/make_android_icons.py <brand_dir>
"""
import sys, os
from PIL import Image, ImageDraw

brand = sys.argv[1]
res = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'android', 'app', 'src', 'main', 'res')
icon = Image.open(os.path.join(brand, 'icon-1024.png')).convert('RGBA')
mark = Image.open(os.path.join(brand, 'mark-transparent-1024.png')).convert('RGBA')

DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

def round_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m

def circle_mask(size):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m

for name, scale in DENSITIES.items():
    d = os.path.join(res, f'mipmap-{name}')
    os.makedirs(d, exist_ok=True)
    s = int(48 * scale)
    legacy = icon.resize((s, s), Image.LANCZOS)
    legacy.putalpha(round_mask(s, int(s * 0.18)))
    legacy.save(os.path.join(d, 'ic_launcher.png'))
    rnd = icon.resize((s, s), Image.LANCZOS)
    rnd.putalpha(circle_mask(s))
    rnd.save(os.path.join(d, 'ic_launcher_round.png'))
    f = int(108 * scale)
    fg = Image.new('RGBA', (f, f), (0, 0, 0, 0))
    inner = int(f * 0.56)
    m = mark.resize((inner, inner), Image.LANCZOS)
    fg.paste(m, ((f - inner) // 2, (f - inner) // 2), m)
    fg.save(os.path.join(d, 'ic_launcher_foreground.png'))
    print(name, s, f)

bg = os.path.join(res, 'values', 'ic_launcher_background.xml')
open(bg, 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1F5A4B</color>\n</resources>\n')
print('background color set to evergreen')
