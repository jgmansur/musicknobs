#!/usr/bin/env python3
"""
Agrega texto SEO sobre un thumbnail YouTube con tipografía profesional.

Estilo basado en benchmark Damian Keyes (channel-analysis/damian-keyes en Engram):
- Fuente: Big Shoulders Display Black (peso 900) — alternativa gratuita a Druk Wide Bold
- Stroke negro grueso
- Sombra dura (hard shadow, sin blur) tipo Damian / MrBeast
- MAYÚSCULAS siempre
- Paleta validada: blanco / amarillo Damian / rojo tensión / naranja / cian

Uso:
  python3 add_text_overlay.py <imagen> "TEXTO SEO"
  python3 add_text_overlay.py <imagen> "TEXTO SEO" output.jpg
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --position=bottom
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --position=top
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --position=center
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --color=yellow
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --color=red       # palabras de tensión
  python3 add_text_overlay.py <imagen> "TEXTO SEO" --no-shadow       # desactivar sombra dura

Posiciones: bottom (default) | top | center
Colores: white (default) | yellow | red | orange | cyan
"""
import sys
import os
from PIL import Image, ImageDraw, ImageFont

# Fuente oficial Music Knobs — Big Shoulders Display Black (variable font, peso 900)
# Alternativa gratuita a Druk Wide Bold ($200), 90% similitud. OFL license.
BIG_SHOULDERS_FONT = os.path.expanduser("~/Library/Fonts/BigShouldersDisplay-Variable.ttf")
IMPACT_FONT        = "/System/Library/Fonts/Supplemental/Impact.ttf"
FALLBACK_FONT      = "/System/Library/Fonts/Supplemental/Arial Black.ttf"

DEFAULT_WEIGHT = 900  # Black

# Paleta validada (benchmark Damian Keyes)
COLOR_MAP = {
    "white":  (255, 255, 255),
    "yellow": (255, 215,   0),  # #FFD700 — amarillo Damian, titular principal
    "red":    (255,  26,  26),  # #FF1A1A — palabras de tensión (TRAMPA, BRUTAL, ARRUINANDO)
    "orange": (255, 140,   0),
    "cyan":   (  0, 230, 255),
}

def get_font(size, weight=DEFAULT_WEIGHT):
    """Carga Big Shoulders Display al peso pedido (con fallbacks a Impact / Arial Black)."""
    for path in [BIG_SHOULDERS_FONT, IMPACT_FONT, FALLBACK_FONT]:
        if not os.path.exists(path):
            continue
        try:
            font = ImageFont.truetype(path, size)
            # Si es Big Shoulders (variable font), aplicar peso 900 (Black)
            if path == BIG_SHOULDERS_FONT:
                try:
                    font.set_variation_by_axes([weight])
                except Exception:
                    pass  # Si Pillow no soporta variations, usa peso default del archivo
            return font
        except Exception:
            continue
    return ImageFont.load_default()

def add_seo_text(image_path, text, output_path=None, position="bottom",
                 color="white", hard_shadow=True):
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

    # 1) Sombra dura (estilo Damian Keyes / MrBeast — sin blur)
    if hard_shadow:
        shadow_offset = max(font_size // 25, 4)
        draw.text((x + shadow_offset, y + shadow_offset),
                  text_upper, font=font, fill=(0, 0, 0))

    # 2) Contorno negro grueso para contraste máximo
    stroke = max(font_size // 12, 4)
    for dx in range(-stroke, stroke + 1):
        for dy in range(-stroke, stroke + 1):
            if dx != 0 or dy != 0:
                draw.text((x + dx, y + dy), text_upper, font=font, fill=(0, 0, 0))

    # 3) Texto principal
    draw.text((x, y), text_upper, font=font, fill=fill_color)

    output = output_path or image_path
    img.save(output, "JPEG", quality=92)

    font_name = "Big Shoulders Display Black" if os.path.exists(BIG_SHOULDERS_FONT) else "Impact (fallback)"
    print(f"Texto aplicado: '{text_upper}'")
    print(f"Fuente: {font_name} | Color: {color} | Sombra dura: {hard_shadow}")
    print(f"Guardado: {output} ({W}x{H}px, font={font_size}px)")
    return output


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    image_path  = sys.argv[1]
    text        = sys.argv[2]
    output      = None
    position    = "bottom"
    color       = "white"
    hard_shadow = True

    for arg in sys.argv[3:]:
        if arg.startswith("--position="):
            position = arg.split("=", 1)[1]
        elif arg.startswith("--color="):
            color = arg.split("=", 1)[1]
        elif arg == "--no-shadow":
            hard_shadow = False
        elif not arg.startswith("--"):
            output = arg

    add_seo_text(image_path, text, output, position, color, hard_shadow)
