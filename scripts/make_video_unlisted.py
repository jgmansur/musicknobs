import pickle
import os
from googleapiclient.discovery import build

TOKEN_FILE = "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/scripts/token.pickle"

def get_authenticated_service():
    with open(TOKEN_FILE, 'rb') as token:
        credentials = pickle.load(token)
    return build('youtube', 'v3', credentials=credentials)

youtube = get_authenticated_service()
video_id = "hDyXAfxPB1w"

try:
    request = youtube.videos().update(
        part="status",
        body={
            "id": video_id,
            "status": {
                "privacyStatus": "unlisted",
                "embeddable": True
            }
        }
    )
    response = request.execute()
    print(f"Success! Updated {video_id} to privacyStatus: {response['status']['privacyStatus']}")
except Exception as e:
    print(f"Failed to update: {e}")
