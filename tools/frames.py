#!/usr/bin/env python3
"""Render every animation step of a chapter to PNG contact sheets — no browser needed.

    node tools/smoke.js chNN.html --frames /tmp/frames && python3 tools/frames.py /tmp/frames chNN

Writes one PNG per animation, <dir>/<chapter>__<scene>.png, showing the final frame of each
narration step (two per row) with its caption underneath. Open them with any image viewer
(or the Read tool) and look for overlapping labels, text running past the edge, and
elements that never appeared. Requires cairosvg and Pillow (both present on this machine).
"""
import json, os, re, sys, textwrap
import cairosvg
from PIL import Image, ImageDraw, ImageFont

def main(d, stem):
    idx = json.load(open(os.path.join(d, stem + '__frames.json')))
    scenes = {}
    for fr in idx: scenes.setdefault(fr['scene'], []).append(fr)
    try: font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 13)
    except Exception: font = ImageFont.load_default()
    out = []
    for scene, frames in scenes.items():
        imgs = []
        for fr in frames:
            png = os.path.join(d, fr['file'].replace('.svg', '.png'))
            cairosvg.svg2png(url=os.path.join(d, fr['file']), write_to=png, output_width=900, background_color='white')
            imgs.append((Image.open(png).convert('RGB'), fr))
        W = 460; cols = 2
        cells = []
        for im, fr in imgs:
            h = int(im.height * W / im.width)
            im2 = im.resize((W, h), Image.LANCZOS)
            cap = textwrap.wrap(f"step {fr['step']} · t={fr['t']}s · {fr['caption']}", 78)[:4]
            ch = 16 * len(cap) + 10
            cell = Image.new('RGB', (W, h + ch), 'white')
            cell.paste(im2, (0, 0))
            dr = ImageDraw.Draw(cell)
            dr.rectangle([0, 0, W - 1, h - 1], outline=(200, 195, 185))
            for i, line in enumerate(cap): dr.text((4, h + 4 + 16 * i), line, fill=(60, 60, 60), font=font)
            cells.append(cell)
        rows = (len(cells) + cols - 1) // cols
        rh = [max(c.height for c in cells[r * cols:(r + 1) * cols]) for r in range(rows)]
        sheet = Image.new('RGB', (W * cols + 12 * (cols + 1), sum(rh) + 12 * (rows + 1)), (245, 243, 236))
        y = 12
        for r in range(rows):
            for c in range(cols):
                k = r * cols + c
                if k < len(cells): sheet.paste(cells[k], (12 + c * (W + 12), y))
            y += rh[r] + 12
        p = os.path.join(d, f'{stem}__{scene}.png'); sheet.save(p); out.append(p)
    print('\n'.join(out))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
