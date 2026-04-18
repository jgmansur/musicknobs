"""
apply_thumbnails_rh.py
Aplica thumbnails a los episodios de "Un Padre de Tres" via YouTube Data API.
Canal: Roby & Hans Place

Uso:
  python3 apply_thumbnails_rh.py --dir=/ruta/a/thumbnails/
  python3 apply_thumbnails_rh.py --dir=/ruta/ --ep=1          # solo un episodio
  python3 apply_thumbnails_rh.py --list                        # lista videos del canal

Nombres de archivo esperados en --dir:
  ep1.png (o ep1.jpg), ep2.png, ep3.png ... ep7.png
"""
import os
import sys
import mimetypes
sys.path.insert(0, os.path.dirname(__file__))

from googleapiclient.http import MediaFileUpload
from youtube_uploader_rh import get_authenticated_service

# ─── Episodios de la Serie 1: Un Padre de Tres ───────────────────────────────
EPISODES = [
    {"ep": 1, "video_id": "WIVl54hzG9w", "title": "Capitulo 1 | Una Piñata Tenebrosa"},
    {"ep": 2, "video_id": "RD19K70hW2w", "title": "Capitulo 2 | Visita a los Abuelos — Parte 1"},
    {"ep": 3, "video_id": "XWWDpdRNBaY", "title": "Capitulo 3 | Visita a los Abuelos Parte 2 + ¡La Feria!"},
    {"ep": 4, "video_id": "DchSHG-O778", "title": "Capitulo 4 | Día de Muertos"},
    {"ep": 5, "video_id": "3BBqLmmc_s0", "title": "Capitulo 5 | Zoológico de Tamatán"},
    {"ep": 6, "video_id": "jI-PVaQBB5o", "title": "Capitulo 6 | Viaje a USA y Visita al Circo"},
    {"ep": 7, "video_id": "ax2I1CIa5rc", "title": "Capitulo 7 | Piñito de Navidad y Festival de Piano"},
]


def find_thumbnail(directory, ep_number):
    """Busca ep{N}.png o ep{N}.jpg en el directorio dado."""
    for ext in ("png", "jpg", "jpeg", "webp"):
        path = os.path.join(directory, f"ep{ep_number}.{ext}")
        if os.path.exists(path):
            return path
    return None


def apply_thumbnail(youtube, video_id, thumbnail_path, ep_title):
    print(f"\n  🖼  {ep_title}")
    print(f"       Video ID:  {video_id}")
    print(f"       Thumbnail: {thumbnail_path}")

    mime, _ = mimetypes.guess_type(thumbnail_path)
    if not mime:
        mime = "image/jpeg"

    try:
        youtube.thumbnails().set(
            videoId=video_id,
            media_body=MediaFileUpload(thumbnail_path, mimetype=mime)
        ).execute()
        print(f"  ✅ Aplicado")
        return True
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False


def list_channel_videos(youtube):
    response = youtube.search().list(
        part="snippet", forMine=True, type="video", maxResults=50, order="date"
    ).execute()
    print(f"\n{'#':<4} {'Video ID':<15} {'Fecha':<12} Título")
    print("─" * 80)
    for i, item in enumerate(response.get("items", []), 1):
        vid_id = item["id"]["videoId"]
        title  = item["snippet"]["title"]
        date   = item["snippet"]["publishedAt"][:10]
        print(f"{i:<4} {vid_id:<15} {date:<12} {title}")


if __name__ == "__main__":
    args = sys.argv[1:]

    if "--list" in args:
        youtube = get_authenticated_service()
        if youtube:
            list_channel_videos(youtube)
        sys.exit(0)

    # Parsear --dir y --ep opcionales
    thumb_dir  = None
    only_ep    = None

    for arg in args:
        if arg.startswith("--dir="):
            thumb_dir = os.path.expanduser(arg.split("=", 1)[1])
        elif arg.startswith("--ep="):
            only_ep = int(arg.split("=", 1)[1])

    if not thumb_dir:
        print("Uso: python3 apply_thumbnails_rh.py --dir=/ruta/a/thumbnails/")
        print("     python3 apply_thumbnails_rh.py --dir=/ruta/ --ep=3")
        print("     python3 apply_thumbnails_rh.py --list")
        sys.exit(1)

    if not os.path.isdir(thumb_dir):
        print(f"❌ Directorio no encontrado: {thumb_dir}")
        sys.exit(1)

    youtube = get_authenticated_service()
    if not youtube:
        print("❌ No se pudo autenticar. Corre: python3 youtube_uploader_rh.py --auth_only")
        sys.exit(1)

    episodes = EPISODES if only_ep is None else [e for e in EPISODES if e["ep"] == only_ep]

    print(f"\n🚀 Aplicando thumbnails desde: {thumb_dir}")
    results = []
    for ep in episodes:
        path = find_thumbnail(thumb_dir, ep["ep"])
        if not path:
            print(f"\n  ⚠️  Ep.{ep['ep']} — archivo no encontrado (ep{ep['ep']}.png / .jpg)")
            results.append({"ep": ep["ep"], "title": ep["title"], "ok": False})
            continue
        ok = apply_thumbnail(youtube, ep["video_id"], path, ep["title"])
        results.append({"ep": ep["ep"], "title": ep["title"], "ok": ok})

    print("\n" + "─" * 60)
    print("📊 Resumen:")
    for r in results:
        icon = "✅" if r["ok"] else "❌"
        print(f"  {icon} Ep.{r['ep']} — {r['title']}")

    failed = [r for r in results if not r["ok"]]
    if failed:
        print(f"\n⚠️  {len(failed)} episodio(s) fallaron.")
        sys.exit(1)
    else:
        print("\n🎉 Todos los thumbnails aplicados exitosamente.")
