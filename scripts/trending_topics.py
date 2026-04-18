"""
trending_topics.py — Music Knobs Trending Topics Finder

Busca temas en tendencia relevantes para el canal Music Knobs usando múltiples fuentes:
  - YouTube Data API v3 (videos populares del nicho)
  - Google Trends via pytrends
  - Reddit (endpoint público, sin API key)
  - RSS de medios especializados (MusicRadar, SoundOnSound, CDM, Synthtopia)

Uso:
  python3 trending_topics.py --source youtube --keywords "produccion musical,DAW" --days 14
  python3 trending_topics.py --source trends --keywords "plugins DAW,AI music" --days 14
  python3 trending_topics.py --source reddit --subreddits "WeAreTheMusicMakers,edmproduction"
  python3 trending_topics.py --source rss
  python3 trending_topics.py --source all  # corre todas las fuentes
"""

import argparse
import datetime
import json
import os
import sys
import time

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────

CLIENT_SECRETS_FILE = "/Users/jaystudio/Library/CloudStorage/GoogleDrive-jgmansur2@gmail.com/My Drive/MUSIC KNOBS/client_secret.json"
TOKEN_FILE = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/token.pickle"

CHANNEL_ID = "UCdBJQ3lKRgX4qm42tC7s7bA"  # Music Knobs

RSS_FEEDS = [
    ("MusicRadar", "https://www.musicradar.com/rss"),
    ("SoundOnSound", "https://www.soundonsound.com/rss"),
    ("CDM", "https://cdm.link/feed"),
    ("Synthtopia", "https://www.synthtopia.com/feed/"),
]

DEFAULT_KEYWORDS = [
    "produccion musical",
    "music production",
    "plugins DAW",
    "AI music",
    "derechos de autor musica",
    "mezcla mastering",
    "Ableton Logic Pro Tools",
]

DEFAULT_SUBREDDITS = [
    "WeAreTheMusicMakers",
    "edmproduction",
    "audioengineering",
]


# ─────────────────────────────────────────────
# YouTube source
# ─────────────────────────────────────────────

def fetch_youtube(keywords_str, days=14):
    """Busca videos populares del nicho en YouTube usando la API v3."""
    print(f"\n[YouTube] Buscando videos de los últimos {days} días...")

    try:
        import pickle
        from googleapiclient.discovery import build
        from google.auth.transport.requests import Request

        credentials = None
        if os.path.exists(TOKEN_FILE):
            with open(TOKEN_FILE, 'rb') as f:
                credentials = pickle.load(f)

        if not credentials or not credentials.valid:
            if credentials and credentials.expired and credentials.refresh_token:
                credentials.refresh(Request())
            else:
                print("[YouTube] ERROR: No hay credenciales válidas. Corre youtube_uploader.py --auth_only primero.")
                return []

        youtube = build('youtube', 'v3', credentials=credentials)

        published_after = (datetime.datetime.utcnow() - datetime.timedelta(days=days)).isoformat() + "Z"
        keywords = [k.strip() for k in keywords_str.split(",")]

        results = []
        for keyword in keywords[:5]:  # máx 5 keywords para no quemar cuota
            try:
                response = youtube.search().list(
                    part="snippet",
                    q=keyword,
                    type="video",
                    order="viewCount",
                    publishedAfter=published_after,
                    relevanceLanguage="es",
                    maxResults=5,
                ).execute()

                for item in response.get("items", []):
                    snippet = item["snippet"]
                    results.append({
                        "source": "YouTube",
                        "keyword": keyword,
                        "title": snippet.get("title", ""),
                        "channel": snippet.get("channelTitle", ""),
                        "published": snippet.get("publishedAt", "")[:10],
                        "description": snippet.get("description", "")[:150],
                    })
                time.sleep(0.2)  # rate limiting
            except Exception as e:
                print(f"  [YouTube] Error con keyword '{keyword}': {e}")

        print(f"[YouTube] {len(results)} resultados encontrados")
        return results

    except ImportError:
        print("[YouTube] ERROR: googleapiclient no instalado. Instalar con: pip3 install google-api-python-client")
        return []
    except Exception as e:
        print(f"[YouTube] ERROR: {e}")
        return []


# ─────────────────────────────────────────────
# Google Trends source
# ─────────────────────────────────────────────

def fetch_trends(keywords_str, days=14):
    """Obtiene tendencias de Google Trends para los keywords dados."""
    print(f"\n[Google Trends] Consultando tendencias de {days} días...")

    try:
        from pytrends.request import TrendReq

        keywords = [k.strip() for k in keywords_str.split(",")]
        # pytrends acepta máx 5 keywords por request
        chunks = [keywords[i:i+5] for i in range(0, len(keywords), 5)]

        pytrends = TrendReq(hl='es-MX', tz=360)
        results = []

        for chunk in chunks:
            try:
                timeframe = f"today {days}-d" if days <= 90 else "today 3-m"
                pytrends.build_payload(chunk, cat=0, timeframe=timeframe, geo='', gprop='')
                interest = pytrends.interest_over_time()

                if interest.empty:
                    continue

                for kw in chunk:
                    if kw in interest.columns:
                        avg_score = interest[kw].mean()
                        max_score = interest[kw].max()
                        results.append({
                            "source": "Google Trends",
                            "keyword": kw,
                            "avg_interest": round(float(avg_score), 1),
                            "peak_interest": round(float(max_score), 1),
                        })
                time.sleep(1)  # rate limiting de pytrends
            except Exception as e:
                print(f"  [Trends] Error en chunk {chunk}: {e}")

        results.sort(key=lambda x: x.get("avg_interest", 0), reverse=True)
        print(f"[Google Trends] {len(results)} keywords analizados")
        return results

    except ImportError:
        print("[Google Trends] ERROR: pytrends no instalado. Instalar con: pip3 install pytrends")
        return []
    except Exception as e:
        print(f"[Google Trends] ERROR: {e}")
        return []


# ─────────────────────────────────────────────
# Reddit source
# ─────────────────────────────────────────────

def fetch_reddit(subreddits_str):
    """Lee posts top de la semana de subreddits relevantes (sin API key)."""
    print(f"\n[Reddit] Consultando posts top de la semana...")

    try:
        import urllib.request

        subreddits = [s.strip() for s in subreddits_str.split(",")]
        results = []

        headers = {
            'User-Agent': 'MusicKnobs-TrendingBot/1.0',
        }

        for sub in subreddits:
            url = f"https://www.reddit.com/r/{sub}/top.json?t=week&limit=10"
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=10) as response:
                    data = json.loads(response.read().decode())

                posts = data.get("data", {}).get("children", [])
                for post in posts:
                    p = post.get("data", {})
                    if p.get("score", 0) > 50:  # filtrar posts con poco engagement
                        results.append({
                            "source": f"Reddit r/{sub}",
                            "title": p.get("title", ""),
                            "score": p.get("score", 0),
                            "comments": p.get("num_comments", 0),
                            "url": f"https://reddit.com{p.get('permalink', '')}",
                        })
                time.sleep(0.5)
            except Exception as e:
                print(f"  [Reddit] Error en r/{sub}: {e}")

        results.sort(key=lambda x: x.get("score", 0), reverse=True)
        print(f"[Reddit] {len(results)} posts encontrados")
        return results

    except Exception as e:
        print(f"[Reddit] ERROR: {e}")
        return []


# ─────────────────────────────────────────────
# RSS source
# ─────────────────────────────────────────────

def fetch_rss():
    """Lee RSS feeds de medios especializados en producción musical."""
    print(f"\n[RSS] Leyendo feeds de medios especializados...")

    try:
        import feedparser

        results = []
        cutoff = datetime.datetime.now() - datetime.timedelta(days=7)

        for name, url in RSS_FEEDS:
            try:
                feed = feedparser.parse(url)
                for entry in feed.entries[:10]:
                    # Intentar parsear la fecha
                    published = None
                    if hasattr(entry, 'published_parsed') and entry.published_parsed:
                        published = datetime.datetime(*entry.published_parsed[:6])
                    elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                        published = datetime.datetime(*entry.updated_parsed[:6])

                    if published and published < cutoff:
                        continue  # ignorar artículos viejos

                    results.append({
                        "source": f"RSS:{name}",
                        "title": getattr(entry, 'title', ''),
                        "summary": getattr(entry, 'summary', '')[:200],
                        "published": published.strftime('%Y-%m-%d') if published else "unknown",
                        "link": getattr(entry, 'link', ''),
                    })
                print(f"  {name}: {len(feed.entries)} artículos")
            except Exception as e:
                print(f"  [RSS] Error en {name}: {e}")

        print(f"[RSS] {len(results)} artículos relevantes de la última semana")
        return results

    except ImportError:
        print("[RSS] ERROR: feedparser no instalado. Instalar con: pip3 install feedparser")
        return []
    except Exception as e:
        print(f"[RSS] ERROR: {e}")
        return []


# ─────────────────────────────────────────────
# Output formatter
# ─────────────────────────────────────────────

def print_results(source, results):
    """Imprime resultados de forma legible para Claude."""
    if not results:
        print(f"\n=== {source.upper()}: Sin resultados ===")
        return

    print(f"\n=== {source.upper()} ({len(results)} resultados) ===")
    for i, r in enumerate(results[:15], 1):  # máx 15 por fuente
        if source == "youtube":
            print(f"{i:2}. [{r['keyword']}] {r['title']}")
            print(f"    Canal: {r['channel']} | Fecha: {r['published']}")
        elif source == "trends":
            print(f"{i:2}. {r['keyword']} — Promedio: {r['avg_interest']} | Pico: {r['peak_interest']}")
        elif source == "reddit":
            print(f"{i:2}. [{r['source']}] {r['title']}")
            print(f"    Score: {r['score']} | Comentarios: {r['comments']}")
        elif source == "rss":
            print(f"{i:2}. [{r['source']}] {r['title']} ({r['published']})")
            if r.get('summary'):
                print(f"    {r['summary'][:100]}...")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Music Knobs Trending Topics Finder")
    parser.add_argument("--source", choices=["youtube", "trends", "reddit", "rss", "all"],
                        default="all", help="Fuente de datos")
    parser.add_argument("--keywords", default=",".join(DEFAULT_KEYWORDS),
                        help="Keywords separados por coma (para YouTube y Trends)")
    parser.add_argument("--subreddits", default=",".join(DEFAULT_SUBREDDITS),
                        help="Subreddits separados por coma")
    parser.add_argument("--days", type=int, default=14,
                        help="Ventana de tiempo en días (default: 14)")

    args = parser.parse_args()

    print(f"Music Knobs — Trending Topics Finder")
    print(f"Fuente: {args.source} | Días: {args.days}")
    print("=" * 60)

    if args.source in ("youtube", "all"):
        results = fetch_youtube(args.keywords, args.days)
        print_results("youtube", results)

    if args.source in ("trends", "all"):
        results = fetch_trends(args.keywords, args.days)
        print_results("trends", results)

    if args.source in ("reddit", "all"):
        results = fetch_reddit(args.subreddits)
        print_results("reddit", results)

    if args.source in ("rss", "all"):
        results = fetch_rss()
        print_results("rss", results)

    print("\n" + "=" * 60)
    print("FIN. Claude analiza los resultados anteriores y genera la tabla de temas rankeados.")


if __name__ == "__main__":
    main()
