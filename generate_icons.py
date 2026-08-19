from PIL import Image, ImageDraw
import os

BG = (108, 92, 231, 255)  # #6c5ce7, matches app accent
FG = (242, 242, 245, 255)  # #f2f2f5, matches app text

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(OUT_DIR, exist_ok=True)


def rounded_bg(size, radius_ratio=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)
    return img, draw


def draw_play_triangle(draw, size, scale):
    # Equilateral-ish play triangle centered in the canvas, sized by `scale` (0-1 of canvas)
    w = size * scale
    h = size * scale
    cx, cy = size / 2, size / 2
    # nudge right slightly so the triangle looks visually centered
    offset = w * 0.08
    points = [
        (cx - w / 2 + offset, cy - h / 2),
        (cx - w / 2 + offset, cy + h / 2),
        (cx + w / 2 + offset, cy),
    ]
    draw.polygon(points, fill=FG)


def make_icon(size, scale, filename):
    img, draw = rounded_bg(size)
    draw_play_triangle(draw, size, scale)
    img.save(os.path.join(OUT_DIR, filename))


# Standard "any" purpose icons — triangle fills most of the canvas
make_icon(192, 0.42, "icon-192.png")
make_icon(512, 0.42, "icon-512.png")

# Maskable icons need extra padding (content must sit inside the inner ~80% safe circle)
make_icon(192, 0.30, "icon-192-maskable.png")
make_icon(512, 0.30, "icon-512-maskable.png")

print("icons written to", OUT_DIR)
