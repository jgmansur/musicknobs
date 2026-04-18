import os
import sys
import json
import pickle
import datetime
import subprocess
import re
import tempfile

from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.http import MediaFileUpload

# Configuration (shared with uploader)
CLIENT_SECRETS_FILE = "/Users/jaystudio/Library/CloudStorage/GoogleDrive-jgmansur2@gmail.com/My Drive/MUSIC KNOBS/client_secret.json"
TOKEN_FILE = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/token_mt.pickle"
LOG_FILE = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/uploaded_videos_mt_log.json"
SCOPES = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
]


def get_authenticated_service():
    credentials = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as token:
            credentials = pickle.load(token)

    try:
        if not credentials or not credentials.valid:
            if credentials and credentials.expired and credentials.refresh_token:
                credentials.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
                credentials = flow.run_local_server(port=0)
            with open(TOKEN_FILE, 'wb') as token:
                pickle.dump(credentials, token)
    except Exception as e:
        print(f"CRITICAL ERROR during authentication: {e}")
        return None

    return build('youtube', 'v3', credentials=credentials)


def extract_video_id(url_or_id):
    """Accept full YouTube URL or bare video ID."""
    # Already a bare ID (11 chars alphanumeric+dash+underscore)
    if re.match(r'^[A-Za-z0-9_-]{11}$', url_or_id):
        return url_or_id
    # Extract from URL
    match = re.search(r'(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})', url_or_id)
    if match:
        return match.group(1)
    print(f"ERROR: Could not extract video ID from: {url_or_id}")
    return None


def get_video_info(youtube, video_id):
    """Fetch current video metadata from YouTube API."""
    response = youtube.videos().list(
        part='snippet,status',
        id=video_id
    ).execute()

    if not response.get('items'):
        print(f"ERROR: Video {video_id} not found or not accessible.")
        return None

    item = response['items'][0]
    snippet = item['snippet']
    return {
        'title': snippet.get('title', ''),
        'description': snippet.get('description', ''),
        'tags': snippet.get('tags', []),
        'categoryId': snippet.get('categoryId', '27'),
        'defaultLanguage': snippet.get('defaultLanguage', 'es'),
        'defaultAudioLanguage': snippet.get('defaultAudioLanguage', 'es'),
        'privacyStatus': item['status'].get('privacyStatus', 'private'),
    }


def get_transcript(video_id):
    """
    Download auto-generated subtitles from YouTube using yt-dlp.
    Returns list of (timestamp_str, text) tuples, e.g. [("00:00", "Hola..."), ...]
    """
    print(f"Fetching transcript for video {video_id}...")

    with tempfile.TemporaryDirectory() as tmpdir:
        output_template = os.path.join(tmpdir, '%(id)s')
        cmd = [
            'yt-dlp',
            '--skip-download',
            '--write-auto-subs',
            '--sub-lang', 'es,es-419,es-MX',
            '--sub-format', 'vtt',
            '--output', output_template,
            f'https://www.youtube.com/watch?v={video_id}'
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"yt-dlp error: {result.stderr}")
            return None

        # Find the downloaded VTT file
        vtt_files = [f for f in os.listdir(tmpdir) if f.endswith('.vtt')]
        if not vtt_files:
            print("No subtitle file found. The video may not have auto-generated captions.")
            return None

        vtt_path = os.path.join(tmpdir, vtt_files[0])
        print(f"Subtitle file: {vtt_files[0]}")

        with open(vtt_path, 'r', encoding='utf-8') as f:
            content = f.read()

    return parse_vtt(content)


def parse_vtt(vtt_content):
    """
    Parse VTT subtitle file into clean (MM:SS, text) tuples.

    YouTube auto-captions use a rolling 2-line format: each VTT block shows
    the current line + the previous line again, causing heavy duplication.
    Strategy: collect raw blocks, then reconstruct a clean linear transcript
    by only appending text that's genuinely new (not a prefix of the last output).
    """
    blocks = []
    lines = vtt_content.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        ts_match = re.match(
            r'(\d{1,2}):(\d{2}):(\d{2})\.\d+ --> ',
            line
        )
        if ts_match:
            h = int(ts_match.group(1))
            m = int(ts_match.group(2))
            s = int(ts_match.group(3))
            total_seconds = h * 3600 + m * 60 + s

            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip():
                cleaned = re.sub(r'<[^>]+>', '', lines[i].strip())
                if cleaned:
                    text_lines.append(cleaned)
                i += 1

            text = ' '.join(text_lines).strip()
            if text:
                blocks.append((total_seconds, text))
        i += 1

    if not blocks:
        return []

    # Reconstruct clean transcript:
    # Each block's text is a rolling window. Keep only the NEW portion
    # (text that wasn't already in the previous block's suffix).
    result = []
    prev_text = ""

    for total_seconds, text in blocks:
        mins, secs = divmod(total_seconds, 60)
        timestamp = f"{mins:02d}:{secs:02d}"

        # Find the longest suffix of prev_text that is a prefix of text
        new_part = text
        for split in range(len(prev_text), 0, -1):
            suffix = prev_text[-split:]
            if text.startswith(suffix):
                new_part = text[split:].strip()
                break

        if new_part and new_part != prev_text:
            result.append((timestamp, new_part))

        prev_text = text

    return result


def update_video(youtube, video_id, title, description, tags):
    """Update video snippet (title, description, tags) via YouTube Data API.

    If YouTube rejects the title change (e.g. A/B test running), automatically
    falls back to keeping the current title and updating only description+tags.
    """
    print(f"Updating video {video_id}...")

    if len(title) > 100:
        print(f"ERROR: Title too long ({len(title)} chars). Max 100.")
        return False

    def build_body(t):
        return {
            'id': video_id,
            'snippet': {
                'title': t,
                'description': description,
                'tags': tags,
                'categoryId': '28',
                'defaultLanguage': 'es',
                'defaultAudioLanguage': 'es',
            }
        }

    try:
        response = youtube.videos().update(
            part='snippet',
            body=build_body(title)
        ).execute()
        print(f"Video updated successfully! ID: {response['id']}")
        log_update(video_id, title, description, tags)
        return True
    except Exception as e:
        error_str = str(e)
        if 'UPDATE_TITLE_NOT_ALLOWED_DURING_TEST_AND_COMPARE' in error_str:
            print("⚠️  YouTube A/B title test active — keeping current title, updating description+tags only.")
            current = get_video_info(youtube, video_id)
            if not current:
                return False
            current_title = current['title']
            try:
                response = youtube.videos().update(
                    part='snippet',
                    body=build_body(current_title)
                ).execute()
                print(f"Video updated (description+tags only). ID: {response['id']}")
                log_update(video_id, current_title, description, tags)
                return True
            except Exception as e2:
                print(f"ERROR on fallback update: {e2}")
                return False
        print(f"ERROR updating video: {e}")
        return False


def set_thumbnail(youtube, video_id, thumbnail_path):
    print(f"Uploading thumbnail: {thumbnail_path}...")
    try:
        youtube.thumbnails().set(
            videoId=video_id,
            media_body=MediaFileUpload(thumbnail_path)
        ).execute()
        print("Thumbnail set successfully!")
        return True
    except Exception as e:
        print(f"Error setting thumbnail: {e}")
        return False


def log_update(video_id, title, description, tags):
    entry = {
        "timestamp": datetime.datetime.now().isoformat(),
        "action": "update",
        "video_id": video_id,
        "title": title,
        "description": description,
        "tags": tags,
    }
    data = []
    if os.path.exists(LOG_FILE):
        try:
            with open(LOG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = []
    data.append(entry)
    with open(LOG_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"Update logged to {LOG_FILE}")


if __name__ == "__main__":
    if "--auth_only" in sys.argv:
        youtube = get_authenticated_service()
        if youtube:
            try:
                youtube.channels().list(part="id", mine=True).execute()
                print("HEALTH CHECK: SUCCESS. Authorization is valid and working.")
                sys.exit(0)
            except Exception as e:
                print(f"HEALTH CHECK: FAILED. {e}")
                sys.exit(1)
        sys.exit(1)

    if "--transcript_only" in sys.argv:
        # Usage: python3 youtube_updater.py --transcript_only <video_id_or_url>
        if len(sys.argv) < 3:
            print("Usage: python3 youtube_updater.py --transcript_only <video_id_or_url>")
            sys.exit(1)
        vid = extract_video_id(sys.argv[2])
        if not vid:
            sys.exit(1)
        segments = get_transcript(vid)
        if segments:
            print("\n=== TRANSCRIPT CON TIMESTAMPS ===")
            for ts, text in segments:
                print(f"{ts} | {text}")
        sys.exit(0)

    if len(sys.argv) < 5:
        print("Usage:")
        print("  python3 youtube_updater.py <video_id_or_url> <title> <description> <tags_csv> [--thumbnail=path]")
        print("  python3 youtube_updater.py --transcript_only <video_id_or_url>")
        print("  python3 youtube_updater.py --auth_only")
        sys.exit(1)

    video_id = extract_video_id(sys.argv[1])
    if not video_id:
        sys.exit(1)

    title = sys.argv[2]
    description = sys.argv[3].replace('\\n', '\n')
    tags = sys.argv[4].split(',')

    thumbnail_path = None
    for arg in sys.argv[5:]:
        if arg.startswith("--thumbnail="):
            thumbnail_path = arg.split("=", 1)[1]

    youtube = get_authenticated_service()
    if not youtube:
        sys.exit(1)

    success = update_video(youtube, video_id, title, description, tags)

    if success and thumbnail_path:
        set_thumbnail(youtube, video_id, thumbnail_path)
