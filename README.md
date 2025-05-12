#**MET Artworks to Google Drive (Synchronous Node.js App)****
This Node.js server synchronously integrates the MET Museum API and Google Drive API (OAuth2) to search for MET artworks and upload selected artwork images and metadata to your Google Drive. It uses a strict synchronous request queue pattern (no Promises, no async/await, no setTimeout, etc.) and only Node core modules.

## **🚀 Features****
OAuth2-based Google authentication.

Searches the MET Museum for artworks based on a keyword.

Uploads both image and metadata (text file) of a random artwork to your Google Drive.

Ensures one-at-a-time request handling using a custom synchronous queue.

Fully implemented using only Node's built-in modules.

## **🛠 Requirements****
Node.js (v14+ recommended)

A Google Cloud project with OAuth 2.0 Client ID

A folder named folder_id.txt will be created to cache your Google Drive folder ID.

## **🔐 Google OAuth Setup**
Go to the Google Cloud Console.
https://console.cloud.google.com/

Create a project and enable the Google Drive API.

Navigate to APIs & Services > Credentials, click Create Credentials > OAuth client ID.

Choose Web Application.

Set http://localhost:3000/oauth2callback as an authorized redirect URI.

Save your Client ID and Client Secret.

**NOTE:** VERY IMPORTANT; it won't let you use it completely once you sign-in since Google doesn't
inherently trust the MET API, so it blocks it. Make sure to use your own Google account as a test
user in the Project iteself. 

Update the placeholders in server.js:

const client_id = 'YOUR_CLIENT_ID';
const client_secret = 'YOUR_CLIENT_SECRET';

##**🧪 How to Run**
Install Node.js if not already installed.

Save the code into server.js.

Run the server:

node server.js
Open http://localhost:3000 in your browser.

Click "Login to Google" to authenticate.

After authenticating, enter a search term (e.g., "Van Gogh").

The app will:

Search MET artworks

Pick one at random

Upload its image and a .txt metadata file to your Google Drive.

##**✅ How It Works**
**1. Request Queue System**
All requests are placed into a queue and processed synchronously.

No concurrent request handling—ensures predictability and no race conditions.

**2. MET API**
Uses /search to find artwork IDs by keyword.

Picks a random ID, then uses /objects/:id to get full details.

**3. Google Drive Integration**
First creates a folder named "MET Artworks" (once). In the event that it does exist
from previous separate runs, it'll use the same folder ID.

**Uploads two files:**

The artwork image (.jpg)

A metadata text file (.txt) with artist name, date, department, etc.

##**🛡 Limitations**
This project does not use Promises, fetch, async/await, or third-party modules.
It's intentionally made for demonstrating two APIs interacting with each other
and adhering to strict synchronous methods.


Google OAuth tokens are not refreshed automatically (offline token is requested, but not used).
