import os
import pickle
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

TOKEN_FILE = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/token.pickle"

def get_authenticated_service():
    credentials = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as token:
            credentials = pickle.load(token)
    
    if not credentials or not credentials.valid:
        if credentials and credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
        else:
            return None

    return build('youtube', 'v3', credentials=credentials)

def check_video(video_id):
    youtube = get_authenticated_service()
    if not youtube:
        print("Not authenticated")
        return

    request = youtube.videos().list(
        part="snippet,status,contentDetails,processingDetails",
        id=video_id
    )
    response = request.execute()
    
    if not response['items']:
        print(f"Video {video_id} not found.")
        return

    item = response['items'][0]
    print(f"Title: {item['snippet']['title']}")
    print(f"Status: {item['status']['uploadStatus']}")
    print(f"Privacy: {item['status']['privacyStatus']}")
    if 'processingDetails' in item:
        print(f"Processing Status: {item['processingDetails']['processingStatus']}")
    if 'contentDetails' in item:
        print(f"Duration: {item['contentDetails'].get('duration', 'N/A')}")

if __name__ == "__main__":
    import sys
    video_id = sys.argv[1] if len(sys.argv) > 1 else "bAMvR7BC28U"
    check_video(video_id)
