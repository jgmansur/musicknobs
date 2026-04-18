#!/usr/bin/env python3
"""
Genera thumbnails YouTube 16:9 usando Nano Banana (Imagen 3/4 de Google).
Opcionalmente agrega texto SEO sobre la imagen generada.

NOTA: Imagen3/Imagen4 requieren billing habilitado. El free tier los bloquea.
El flujo normal es generar MANUALMENTE en aistudio.google.com y descargar a:
  /Volumes/External SSD/Dropbox/03 - DOWNLOADS/

Modelos disponibles:
  imagen4  → imagen-4.0-generate-001 (mejor calidad, requiere billing) [DEFAULT]
  imagen3  → imagen-3.0-generate-002 (alta calidad, requiere billing)
  flash    → gemini-2.0-flash-preview-image-generation (free tier)

Modos:
  generate  → generacion desde cero con texto (DEFAULT)
  bgswap    → intercambia el fondo de una foto de referencia (--reference=foto.jpg)
              Ideal para thumbnails con Jay: preserva su cara, cambia el fondo.

Uso:
  python3 generate_thumbnail_16x9.py "<prompt>" [output.jpg]
  python3 generate_thumbnail_16x9.py "<prompt>" output.jpg --text="APRENDE ESTO"
  python3 generate_thumbnail_16x9.py "<prompt>" output.jpg --model=flash
  python3 generate_thumbnail_16x9.py "<background prompt>" output.jpg --mode=bgswap --reference="Jay Looks 1.jpg"
  python3 generate_thumbnail_16x9.py "<prompt>" output.jpg --text="SEO" --color=yellow --position=bottom

Requiere: export GEMINI_API_KEY='tu_api_key'
"""
import sys
import os
import base64
from google import genai
from google.genai import types

MODELS = {
    "imagen4": "imagen-4.0-generate-001",
    "imagen3": "imagen-3.0-generate-002",
    "flash":   "gemini-2.0-flash-preview-image-generation",
}

# Foto de referencia por defecto de Jay — para modo bgswap
DEFAULT_REFERENCE = (
    "/Users/jaystudio/Library/CloudStorage/"
    "GoogleDrive-jgmansur2@gmail.com/My Drive/MUSIC KNOBS/"
    "Fotos para Imagen Personal Thumbnails/Jay Looks 1.jpg"
)


def generate_with_imagen(client, model_id, prompt, output_file):
    response = client.models.generate_images(
        model=model_id,
        prompt=prompt,
        config=types.GenerateImagesConfig(
            aspect_ratio="16:9",
            number_of_images=1,
            output_mime_type="image/jpeg",
        )
    )
    if not response.generated_images:
        print("Error: La API no devolvio ninguna imagen.")
        sys.exit(1)
    image_bytes = response.generated_images[0].image.image_bytes
    with open(output_file, "wb") as f:
        f.write(image_bytes)
    return len(image_bytes)


def generate_with_bgswap(client, model_id, background_prompt, reference_path, output_file):
    """
    Intercambia el fondo de la foto de referencia usando Imagen Edit.
    Jay (u otra persona) se preserva, el fondo cambia al prompt indicado.
    Ideal para thumbnails consistentes con la misma foto base.
    """
    if not os.path.exists(reference_path):
        print(f"Error: foto de referencia no encontrada: {reference_path}")
        sys.exit(1)

    with open(reference_path, "rb") as f:
        ref_bytes = f.read()

    # Usar modelo de edición compatible
    edit_model = model_id.replace("generate", "edit").replace("-001", "-001")
    if "generate" in edit_model:
        edit_model = "imagen-3.0-edit-001"

    print(f"Modo: Background Swap | Referencia: {os.path.basename(reference_path)}")

    response = client.models.edit_image(
        model=edit_model,
        prompt=background_prompt,
        reference_images=[
            types.RawReferenceImage(
                reference_id=1,
                reference_image=types.Image(image_bytes=ref_bytes),
            )
        ],
        config=types.EditImageConfig(
            edit_mode=types.EditMode.EDIT_MODE_BGSWAP,
            number_of_images=1,
            output_mime_type="image/jpeg",
        ),
    )
    if not response.generated_images:
        print("Error: BGSWAP no devolvio imagen.")
        sys.exit(1)
    image_bytes = response.generated_images[0].image.image_bytes
    with open(output_file, "wb") as f:
        f.write(image_bytes)
    return len(image_bytes)


def generate_with_flash(client, prompt, output_file):
    full_prompt = f"Generate a YouTube thumbnail with 16:9 aspect ratio. {prompt}"
    response = client.models.generate_content(
        model=MODELS["flash"],
        contents=full_prompt,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        )
    )
    image_bytes = None
    for candidate in response.candidates:
        for part in candidate.content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                image_bytes = part.inline_data.data
                if isinstance(image_bytes, str):
                    image_bytes = base64.b64decode(image_bytes)
                break
        if image_bytes:
            break

    if not image_bytes:
        print("Error: Gemini Flash no devolvio imagen.")
        sys.exit(1)

    with open(output_file, "wb") as f:
        f.write(image_bytes)
    return len(image_bytes)


def apply_text_overlay(output_file, seo_text, text_color, text_position):
    import subprocess
    overlay_script = os.path.join(os.path.dirname(__file__), "add_text_overlay.py")
    if not os.path.exists(overlay_script):
        print(f"Advertencia: add_text_overlay.py no encontrado.")
        return
    result = subprocess.run(
        [sys.executable, overlay_script, output_file, seo_text,
         f"--position={text_position}", f"--color={text_color}"],
        capture_output=True, text=True
    )
    print(result.stdout.strip())
    if result.returncode != 0:
        print(f"Advertencia en texto overlay: {result.stderr.strip()}")


def generate_16x9(prompt, output_file="thumbnail_16x9.jpg", model_key="imagen4",
                  mode="generate", reference_path=None,
                  seo_text=None, text_color="white", text_position="bottom"):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: No se encontro GEMINI_API_KEY.")
        print("  export GEMINI_API_KEY='tu_api_key_de_google_ai_studio'")
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)

    model_id = MODELS.get(model_key, MODELS["imagen4"])
    print(f"Modelo: {model_id}")
    print(f"Prompt: {prompt}")
    print(f"Destino: {output_file}")

    client = genai.Client(api_key=api_key)

    try:
        if mode == "bgswap":
            ref = reference_path or DEFAULT_REFERENCE
            size_bytes = generate_with_bgswap(client, model_id, prompt, ref, output_file)
        elif model_key == "flash":
            size_bytes = generate_with_flash(client, prompt, output_file)
        else:
            size_bytes = generate_with_imagen(client, model_id, prompt, output_file)
    except Exception as e:
        print(f"Error en generacion: {e}")
        sys.exit(1)

    print(f"Imagen guardada: {output_file} ({size_bytes / 1024:.0f} KB)")

    if seo_text:
        apply_text_overlay(output_file, seo_text, text_color, text_position)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    prompt_text    = sys.argv[1]
    out_file       = "thumbnail_16x9.jpg"
    model_key      = "imagen4"
    mode           = "generate"
    reference_path = None
    seo_text       = None
    color          = "white"
    position       = "bottom"

    for arg in sys.argv[2:]:
        if arg.startswith("--model="):
            model_key = arg.split("=", 1)[1]
        elif arg.startswith("--mode="):
            mode = arg.split("=", 1)[1]
        elif arg.startswith("--reference="):
            reference_path = os.path.expanduser(arg.split("=", 1)[1])
        elif arg.startswith("--text="):
            seo_text = arg.split("=", 1)[1]
        elif arg.startswith("--color="):
            color = arg.split("=", 1)[1]
        elif arg.startswith("--position="):
            position = arg.split("=", 1)[1]
        elif not arg.startswith("--"):
            out_file = arg

    if model_key not in MODELS:
        print(f"Modelo desconocido: '{model_key}'. Opciones: {', '.join(MODELS)}")
        sys.exit(1)

    generate_16x9(prompt_text, out_file, model_key, mode, reference_path,
                  seo_text, color, position)
