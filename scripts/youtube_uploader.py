import os
import datetime
import google.oauth2.credentials
import google_auth_oauthlib.flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
import pickle
import json

# Configuration
CLIENT_SECRETS_FILE = "/Users/jaystudio/Library/CloudStorage/GoogleDrive-jgmansur2@gmail.com/My Drive/MUSIC KNOBS/client_secret.json"
TOKEN_FILE = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/token.pickle"
LOG_FILE = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/uploaded_videos_log.json"
SCOPES = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
]

def log_upload(video_id, title, description, tags, file_path, transcription=""):
    log_entry = {
        "timestamp": datetime.datetime.now().isoformat(),
        "video_id": video_id,
        "title": title,
        "description": description,
        "transcription": transcription,
        "tags": tags,
        "file_path": file_path,
        "engagement": {"views": 0, "likes": 0} # Placeholder for future sync
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
    print(f"Upload logged to {LOG_FILE}")

def get_authenticated_service():
    credentials = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as token:
            credentials = pickle.load(token)
    
    if not credentials or not credentials.valid:
        if credentials and credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
            credentials = flow.run_local_server(port=0)
        with open(TOKEN_FILE, 'wb') as token:
            pickle.dump(credentials, token)

    return build('youtube', 'v3', credentials=credentials)

def upload_video(file_path, title, description, tags, recording_date=None, transcription=""):
    youtube = get_authenticated_service()

    body = {
        'snippet': {
            'title': title,
            'description': description,
            'tags': tags,
            'categoryId': '27', # Education
            'defaultAudioLanguage': 'es',
            'defaultLanguage': 'es'
        },
        'status': {
            'privacyStatus': 'private',
            'selfDeclaredMadeForKids': False,
            'license': 'youtube',
            'embeddable': True,
            'publicStatsViewable': True
        }
    }

    if recording_date:
        # Expected format: YYYY-MM-DD
        body['snippet']['recordingDetails'] = {
            'recordingDate': f"{recording_date}T00:00:00Z"
        }

    # Use 5MB chunks and specify mimetype for reliability
    media = MediaFileUpload(file_path, mimetype='video/mp4', chunksize=5 * 1024 * 1024, resumable=True)
    
    request = youtube.videos().insert(
        part=','.join(body.keys()),
        body=body,
        media_body=media
    )

    print(f"Uploading file: {file_path}...")
    response = None
    try:
        while response is None:
            status, response = request.next_chunk()
            if status:
                print(f"Uploaded {int(status.progress() * 100)}%")
        
        print(f"Video uploaded successfully! Video ID: {response['id']}")
        log_upload(response['id'], title, description, tags, file_path, transcription)
        return response['id']
    except Exception as e:
        print(f"An error occurred during upload: {e}")
        return None

if __name__ == "__main__":
    import sys
    if "--auth_only" in sys.argv:
        get_authenticated_service()
        print("Authorization successful!")
        sys.exit(0)
        
    if len(sys.argv) < 5:
        print("Usage: python3 youtube_uploader.py <file_path> <title> <description> <tags_comma_separated> [recording_date_YYYY-MM-DD]")
        sys.exit(1)

    file_path = sys.argv[1]
    title = sys.argv[2]
    # Replaces literal \n with actual newlines to support shell passing
    description = sys.argv[3].replace('\\n', '\n')
    tags = sys.argv[4].split(',')
    
    # Optional arguments
    transcription = ""
    rec_date = None
    
    for arg in sys.argv[5:]:
        if arg.startswith("--transcription="):
            transcription = arg.split("=", 1)[1].replace('\\n', '\n')
        elif arg.startswith("--transcription_file="):
            t_file = arg.split("=", 1)[1]
            if os.path.exists(t_file):
                with open(t_file, 'r', encoding='utf-8') as f:
                    transcription = f.read()
        elif not rec_date and not arg.startswith("--"):
             rec_date = arg

    upload_video(file_path, title, description, tags, rec_date, transcription)
