#!/usr/bin/env python3
"""
Agrega texto SEO sobre un thumbnail YouTube con tipografía profesional.

El texto se muestra en MAYÚSCULAS con contorno negro grueso para máxima
legibilidad como miniatura de YouTube.

Uso:
  python3 add_text_overlay.py <imagen> "TEXTO SEO"
  python3 add_text_overlay.py <imagen> "TEXTO SEO" output.jpg
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --position=bottom
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --position=top
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --position=center
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --color=yellow

Posiciones: bottom (default) | top | center
Colores: white (default) | yellow | orange | cyan
"""
import sys
import os
from PIL import Image, ImageDraw, ImageFont

# Impact es el font icónico de YouTube thumbnails — siempre disponible en macOS
IMPACT_FONT  = "/System/Library/Fonts/Supplemental/Impact.ttf"
FALLBACK_FONT = "/System/Library/Fonts/Supplemental/Arial Black.ttf"

COLOR_MAP = {
    "white":  (255, 255, 255),
    "yellow": (255, 230,   0),
    "orange": (255, 140,   0),
    "cyan":   (  0, 230, 255),
}

def get_font(size):
    for path in [IMPACT_FONT, FALLBACK_FONT]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def add_seo_text(image_path, text, output_path=None, position="bottom", color="white"):
    if not os.path.exists(image_path):
        print(f"Error: archivo no encontrado: {image_path}")
        sys.exit(1)

    img = Image.open(image_path).convert("RGB")
    W, H = img.size
    draw = ImageDraw.Draw(img)

    text_upper = text.upper().strip()
    fill_color = COLOR_MAP.get(color.lower(), (255, 255, 255))

    # Ajusta tamaño hasta que el texto no exceda el 85% del ancho
    font_size = max(int(H * 0.13), 60)
    font = get_font(font_size)
    while font_size > 30:
        font = get_font(font_size)
        bbox = draw.textbbox((0, 0), text_upper, font=font)
        tw = bbox[2] - bbox[0]
        if tw <= W * 0.85:
            break
        font_size = int(font_size * 0.9)

    bbox = draw.textbbox((0, 0), text_upper, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    pad = int(H * 0.055)

    if position == "top":
        x, y = pad, pad
    elif position == "center":
        x = (W - tw) // 2
        y = (H - th) // 2
    else:  # bottom (default)
        x = pad
        y = H - th - pad

    # Contorno negro para contraste máximo
    stroke = max(font_size // 12, 4)
    for dx in range(-stroke, stroke + 1):
        for dy in range(-stroke, stroke + 1):
            if dx != 0 or dy != 0:
                draw.text((x + dx, y + dy), text_upper, font=font, fill=(0, 0, 0))

    # Texto principal
    draw.text((x, y), text_upper, font=font, fill=fill_color)

    output = output_path or image_path
    img.save(output, "JPEG", quality=92)

    print(f"Texto aplicado: '{text_upper}'")
    print(f"Guardado: {output} ({W}x{H}px, font={font_size}px)")
    return output


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    image_path = sys.argv[1]
    text       = sys.argv[2]
    output     = None
    position   = "bottom"
    color      = "white"

    for arg in sys.argv[3:]:
        if arg.startswith("--position="):
            position = arg.split("=", 1)[1]
        elif arg.startswith("--color="):
            color = arg.split("=", 1)[1]
        elif not arg.startswith("--"):
            output = arg

    add_seo_text(image_path, text, output, position, color)
