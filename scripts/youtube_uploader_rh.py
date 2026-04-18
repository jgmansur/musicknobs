import os
import datetime
import mimetypes
import pickle
import json
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

# ─── Canal: Roby & Hans Place ────────────────────────────────────────────────
CLIENT_SECRETS_FILE = "/Users/jaystudio/Library/CloudStorage/GoogleDrive-jgmansur2@gmail.com/My Drive/ROBY HANS/client_secret_rh.json"
TOKEN_FILE = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/token_rh.pickle"
LOG_FILE   = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/uploaded_videos_rh_log.json"
SCOPES = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtubepartner',
]

def get_authenticated_service():
    credentials = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as token:
            credentials = pickle.load(token)

    try:
        if not credentials or not credentials.valid:
            if credentials and credentials.expired and credentials.refresh_token:
                print("Refreshing expired token...")
                credentials.refresh(Request())
            else:
                print("No valid credentials found. Starting local auth flow...")
                flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
                credentials = flow.run_local_server(port=0)

            with open(TOKEN_FILE, 'wb') as token:
                pickle.dump(credentials, token)
                print(f"Token saved to {TOKEN_FILE}")
    except Exception as e:
        print(f"CRITICAL ERROR during authentication: {e}")
        print("Please run this script with --auth_only to manually refresh/re-authorize.")
        return None

    return build('youtube', 'v3', credentials=credentials)


def set_thumbnail(youtube, video_id, thumbnail_path):
    print(f"  Uploading thumbnail: {thumbnail_path}...")
    mime, _ = mimetypes.guess_type(thumbnail_path)
    if not mime:
        mime = "image/jpeg"
    try:
        youtube.thumbnails().set(
            videoId=video_id,
            media_body=MediaFileUpload(thumbnail_path, mimetype=mime)
        ).execute()
        print(f"  ✅ Thumbnail aplicado al video {video_id}")
        return True
    except Exception as e:
        print(f"  ❌ Error setting thumbnail for {video_id}: {e}")
        return False


def upload_video(file_path, title, description, tags, recording_date=None, transcription=""):
    youtube = get_authenticated_service()
    if not youtube:
        return None

    body = {
        'snippet': {
            'title': title,
            'description': description,
            'tags': tags,
            'categoryId': '20',  # Gaming
            'defaultAudioLanguage': 'es',
            'defaultLanguage': 'es'
        },
        'status': {
            'privacyStatus': 'private',
            'selfDeclaredMadeForKids': True,   # ← Canal infantil
            'license': 'youtube',
            'embeddable': True,
            'publicStatsViewable': True
        }
    }

    if recording_date:
        body['snippet']['recordingDetails'] = {
            'recordingDate': f"{recording_date}T00:00:00Z"
        }

    mimetype, _ = mimetypes.guess_type(file_path)
    if not mimetype:
        mimetype = 'video/mp4'

    media = MediaFileUpload(file_path, mimetype=mimetype, chunksize=5 * 1024 * 1024, resumable=True)

    request = youtube.videos().insert(
        part=','.join(body.keys()),
        body=body,
        media_body=media
    )

    print(f"Uploading ({mimetype}): {file_path}...")
    response = None
    try:
        while response is None:
            status, response = request.next_chunk()
            if status:
                print(f"  Uploaded {int(status.progress() * 100)}%")

        video_id = response['id']
        print(f"✅ Video uploaded! ID: {video_id}")

        # Log
        log_entry = {
            "timestamp": datetime.datetime.now().isoformat(),
            "video_id": video_id,
            "title": title,
            "description": description,
            "transcription": transcription,
            "tags": tags,
            "file_path": file_path,
            "engagement": {"views": 0, "likes": 0}
        }
        data = []
        if os.path.exists(LOG_FILE):
            try:
                with open(LOG_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except:
                data = []
        data.append(log_entry)
        with open(LOG_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)

        return video_id
    except Exception as e:
        print(f"❌ Error during upload: {e}")
        return None


if __name__ == "__main__":
    import sys

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
        else:
            print("Authorization failed.")
            sys.exit(1)

    # Standalone thumbnail: --set_thumbnail=VIDEO_ID --thumbnail=PATH
    set_thumb_id = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--set_thumbnail=")), None)
    if set_thumb_id:
        thumb_path = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--thumbnail=")), None)
        if not thumb_path:
            print("❌ Falta --thumbnail=PATH")
            sys.exit(1)
        youtube = get_authenticated_service()
        if youtube:
            set_thumbnail(youtube, set_thumb_id, thumb_path)
        sys.exit(0)

    if len(sys.argv) < 5:
        print("Usage: python3 youtube_uploader_rh.py <file_path> <title> <description> <tags> [date] [--thumbnail=path]")
        print("       python3 youtube_uploader_rh.py --set_thumbnail=VIDEO_ID --thumbnail=PATH")
        sys.exit(1)

    file_path   = sys.argv[1]
    title       = sys.argv[2]
    description = sys.argv[3].replace('\\n', '\n')
    tags        = sys.argv[4].split(',')

    transcription  = ""
    rec_date       = None
    thumbnail_path = None

    for arg in sys.argv[5:]:
        if arg.startswith("--transcription="):
            transcription = arg.split("=", 1)[1].replace('\\n', '\n')
        elif arg.startswith("--transcription_file="):
            t_file = arg.split("=", 1)[1]
            if os.path.exists(t_file):
                with open(t_file, 'r', encoding='utf-8') as f:
                    transcription = f.read()
        elif arg.startswith("--thumbnail="):
            thumbnail_path = arg.split("=", 1)[1]
        elif not rec_date and not arg.startswith("--"):
            rec_date = arg

    video_id = upload_video(file_path, title, description, tags, rec_date, transcription)

    if video_id and thumbnail_path:
        youtube = get_authenticated_service()
        if youtube:
            set_thumbnail(youtube, video_id, thumbnail_path)
