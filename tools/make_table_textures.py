# -*- coding: utf-8 -*-
"""
Генератор текстуры деревянной столешницы (орех) для 3D-сцены.
Вспомогательный инструмент: в сайт входит только результат — файл textures.js.

Что рисуем (8 досок, каждая — полоса 256 px высотой и 2048 px длиной):
  * волокна с «арками» (как у пиленой доски), годичные кольца, длинные прожилки;
  * сучки, вокруг которых волокна изгибаются;
  * поры, мелкие царапины, вмятины, пыль;
  * разная матовость (где-то масло затёрто, где-то блестит).

Результат:
  textures.js       — картинки в виде data-URL (их можно отдать в WebGL даже при
                      открытии сайта двойным щелчком, без сервера)
  preview/wood-*.webp — те же картинки, чтобы посмотреть глазами

Запуск:  python tools/make_table_textures.py
"""
import base64, io, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = np.random.default_rng(2024)

W, BAND, PLANKS = 2048, 256, 8           # длина доски, ширина доски, количество досок
H = BAND * PLANKS


def value_noise(h, w, sx, sy):
    """Плавный случайный шум. sx, sy — размер «пятна» по x и y в пикселях."""
    gx, gy = int(w / sx) + 3, int(h / sy) + 3
    grid = rng.random((gy, gx))
    x = np.arange(w) / sx
    y = np.arange(h) / sy
    xi, yi = x.astype(int), y.astype(int)
    xf, yf = x - xi, y - yi
    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    a = grid[yi[:, None], xi[None, :]]
    b = grid[yi[:, None], xi[None, :] + 1]
    c = grid[yi[:, None] + 1, xi[None, :]]
    d = grid[yi[:, None] + 1, xi[None, :] + 1]
    top = a + (b - a) * u[None, :]
    bot = c + (d - c) * u[None, :]
    return top + (bot - top) * v[:, None]


def fbm(h, w, sx, sy, octaves=4):
    out = np.zeros((h, w)); amp = 0.5; tot = 0
    for _ in range(octaves):
        out += amp * value_noise(h, w, sx, sy); tot += amp
        amp *= 0.5; sx = max(sx / 2, 1); sy = max(sy / 2, 1)
    return out / tot


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def make_plank(k):
    h, w = BAND, W
    X, Y = np.meshgrid(np.arange(w, dtype=float), np.arange(h, dtype=float))

    # --- рисунок волокон ---
    # «арки»: параболы, которые медленно гуляют вдоль доски — как у доски, распиленной вдоль
    center = rng.uniform(-0.3, 1.3) * h
    arch_len = rng.uniform(900, 1700)
    phase = rng.uniform(0, 2 * np.pi)
    arch = 0.00045 * ((Y - center) ** 2) * (1 + 0.4 * np.sin(X / arch_len * 2 * np.pi + phase))
    warp = 70 * (fbm(h, w, 700, 200, 4) - 0.5) + 8 * (fbm(h, w, 160, 50, 3) - 0.5)
    g = (Y + warp) * 0.032 + arch * 0.032 + X * rng.uniform(-0.0008, 0.0008)

    # сучки: волокна огибают их
    knots = []
    for _ in range(rng.integers(0, 3)):
        kx, ky = rng.uniform(100, w - 100), rng.uniform(30, h - 30)
        r = rng.uniform(10, 26)
        d2 = ((X - kx) / (r * 2.2)) ** 2 + ((Y - ky) / r) ** 2
        g += 6 * np.exp(-d2 * 0.5) * np.sign(Y - ky + 1e-3)
        knots.append((kx, ky, r, d2))

    ring = g - np.floor(g)
    # поздняя древесина — тёмные тонкие полосы, ранняя — светлее
    late = smoothstep(0.35, 0.85, ring) * (1 - smoothstep(0.88, 1.0, ring))   # мягкие широкие полосы колец
    fibers = fbm(h, w, 160, 1.3, 4)                     # длинные тонкие волокна вдоль доски — главный рисунок
    fine = value_noise(h, w, 30, 0.7)                   # совсем мелкая «штриховка» волокон
    streak = fbm(h, w, 900, 30, 3)                      # крупные светлые и тёмные прожилки

    t = 0.55 - 0.2 * late + 0.38 * (fibers - 0.5) + 0.1 * (fine - 0.5) + 0.32 * (streak - 0.5)

    # поры — короткие тёмные чёрточки вдоль волокон
    pores = value_noise(h, w, 5, 0.9)
    pore = smoothstep(0.80, 0.93, pores)
    t -= 0.22 * pore

    # заболонь (светлая полоса у края) у некоторых досок
    if rng.random() < 0.35:
        edge = rng.choice([0, h])
        t += 0.25 * np.exp(-np.abs(Y - edge) / rng.uniform(18, 40)) * (0.6 + 0.4 * fbm(h, w, 300, 40, 2))

    for kx, ky, r, d2 in knots:
        t -= 0.55 * np.exp(-d2 * 2.2)                   # тёмная серединка сучка
        t -= 0.15 * np.exp(-d2 * 0.4) * (np.sin(np.sqrt(d2) * 9) * 0.5 + 0.5)

    t = np.clip(t, 0, 1)

    # --- цвет ореха ---
    dark = np.array([42, 27, 18.0]); mid = np.array([92, 60, 39.0]); light = np.array([140, 99, 67.0])
    lo = t < 0.5
    f = np.where(lo, t * 2, (t - 0.5) * 2)[..., None]
    col = np.where(lo[..., None], dark + (mid - dark) * f, mid + (light - mid) * f)
    # у каждой доски свой оттенок (одна теплее, другая серее)
    s, warm = rng.uniform(0.8, 1.12), rng.uniform(-0.05, 0.05)
    col *= np.array([s * (1 + warm), s, s * (1 - warm)])
    # выгоревшие и потемневшие места
    col *= (0.88 + 0.24 * fbm(h, w, 500, 200, 3))[..., None]

    # --- матовость: где масло затёрто, где блестит ---
    rough = 0.5 + 0.18 * (fbm(h, w, 260, 120, 4) - 0.5) * 2 + 0.12 * late + 0.2 * pore
    # --- рельеф: поры и поздняя древесина чуть ниже ---
    height = 0.6 - 0.12 * late - 0.35 * pore + 0.08 * (fibers - 0.5)

    return col, rough, height


cols, roughs, heights = [], [], []
for k in range(PLANKS):
    c, r, hgt = make_plank(k)
    cols.append(c); roughs.append(r); heights.append(hgt)
col = np.concatenate(cols, 0)
rough = np.concatenate(roughs, 0)
height = np.concatenate(heights, 0)

# --- царапины, вмятины, пыль (поверх всех досок) ---
scr = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(scr)
for _ in range(900):                                   # тонкие царапины, чаще вдоль волокон
    x, y = rng.uniform(0, W), rng.uniform(0, H)
    ang = rng.normal(0, 0.35) if rng.random() < 0.7 else rng.uniform(0, np.pi)
    ln = rng.uniform(8, 120)
    d.line([(x, y), (x + np.cos(ang) * ln, y + np.sin(ang) * ln)], fill=int(rng.uniform(60, 200)), width=1)
for _ in range(120):                                   # вмятины
    x, y, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.5, 4)
    d.ellipse([x - r, y - r * 0.7, x + r, y + r * 0.7], fill=int(rng.uniform(100, 220)))
scr = np.asarray(scr.filter(ImageFilter.GaussianBlur(0.6)), dtype=float) / 255

dust = (rng.random((H, W)) > 0.9985).astype(float)    # редкие пылинки
dust = np.asarray(Image.fromarray((dust * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), dtype=float) / 255

col = col * (1 + 0.35 * scr[..., None]) + 120 * dust[..., None] * 0.5   # царапины светлее
rough = np.clip(rough + 0.25 * scr + 0.3 * dust, 0.25, 1)
height = height - 0.35 * scr

# щели между досками в текстуре не рисуем — они настоящие (доски отдельные)
col = np.clip(col, 0, 255).astype(np.uint8)

# карта нормалей из рельефа (для честных бликов на волокнах и царапинах)
hgt = np.asarray(Image.fromarray((np.clip(height, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), dtype=float) / 255
dx = np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)
dy = np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)
strength = 3.0
nx, ny, nz = -dx * strength, dy * strength, np.ones_like(hgt)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([(nx / ln + 1) * 127.5, (ny / ln + 1) * 127.5, (nz / ln + 1) * 127.5], -1).astype(np.uint8)

img_col = Image.fromarray(col, "RGB")
img_rough = Image.fromarray((rough * 255).astype(np.uint8), "L").resize((W // 2, H // 2), Image.LANCZOS)
img_norm = Image.fromarray(normal, "RGB").resize((W // 2, H // 2), Image.LANCZOS)

os.makedirs(os.path.join(ROOT, "preview"), exist_ok=True)


def to_data_url(img, q):
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=q, method=6)
    img.save(os.path.join(ROOT, "preview", f"wood-{name}.webp"), "WEBP", quality=q)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


urls = {}
for name, img, q in [("color", img_col, 84), ("rough", img_rough, 80), ("normal", img_norm, 88)]:
    urls[name] = to_data_url(img, q)

with open(os.path.join(ROOT, "textures.js"), "w", encoding="utf-8") as f:
    f.write("/* Текстуры деревянного стола (сгенерированы скриптом tools/make_table_textures.py).\n")
    f.write("   Хранятся как data-URL, чтобы 3D-сцена могла их использовать даже без сервера.\n")
    f.write("   8 досок: каждая — полоса 1/8 высоты картинки. Руками этот файл не правят. */\n")
    f.write("window.TABLE_TEXTURES = {\n")
    for name in ("color", "rough", "normal"):
        f.write(f'  {name}: "{urls[name]}",\n')
    f.write("};\n")

print("готово:", {k: len(v) // 1024 for k, v in urls.items()}, "КБ (base64)")
