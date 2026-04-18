#!/usr/bin/env python3
"""
Guarda la imagen que está en el clipboard de macOS a un archivo .jpg.

Úsalo cuando Gemini/Antigravity genera una imagen en Google AI Studio (GRATIS)
y la copia al clipboard (derecho clic → "Copy Image").
De esta manera NO se usa la API de pago.

Uso:
  python3 save_clipboard_thumbnail.py output.jpg
  python3 save_clipboard_thumbnail.py /tmp/thumbnails_rh/ep1.jpg

Prerrequisito: Tener una imagen copiada al clipboard (Cmd+C sobre la imagen
en AI Studio, o derecho clic → "Copy Image").
"""
import sys
import os
import subprocess
import tempfile
from PIL import Image


def save_clipboard_image(output_path):
    output_path = os.path.expanduser(output_path)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Usamos un PNG temporal para preservar calidad en el paso intermedio
    tmp_png = tempfile.mktemp(suffix=".png")

    # AppleScript lee el clipboard como PNG y lo escribe a disco
    applescript = f"""
set tmpFile to open for access POSIX file "{tmp_png}" with write permission
set eof tmpFile to 0
write (the clipboard as «class PNGf») to tmpFile
close access tmpFile
"""
    result = subprocess.run(
        ["osascript", "-e", applescript],
        capture_output=True,
        text=True
    )

    if result.returncode != 0 or not os.path.exists(tmp_png) or os.path.getsize(tmp_png) == 0:
        error = result.stderr.strip()
        if not error:
            error = "No hay imagen PNG en el clipboard. Copia la imagen primero (derecho clic → Copy Image)."
        print(f"Error: {error}")
        sys.exit(1)

    # Convierte PNG → JPEG con calidad alta
    img = Image.open(tmp_png).convert("RGB")
    W, H = img.size
    img.save(output_path, "JPEG", quality=92)

    os.unlink(tmp_png)

    size_kb = os.path.getsize(output_path) / 1024
    print(f"Guardado desde clipboard: {output_path}")
    print(f"Dimensiones: {W}x{H}px | Tamaño: {size_kb:.0f} KB")
    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    save_clipboard_image(sys.argv[1])
