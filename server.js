const http = require('http'); // Module for creating HTTP server
const https = require('https'); // Used to make requests to Google/MET
const url = require('url'); // Parses incoming URLs
const querystring = require('querystring'); // Parses query strings from URLs
const fs = require('fs'); 

// OAuth configuration for Google Drive API verification
const client_id = 'PASTE YOUR OWN CLIENT ID';
const client_secret = 'PASTE YOUR OWN SECRET CLIENT ID';
const redirect_uri = 'http://localhost:3000/oauth2callback';
let access_token = '';

// Request queue implementation
const requestQueue = [];
let isProcessing = false;

/**
 * 
 * Ensures synchronous request handling. Only one request is processed at a time
 * and when it finishes, the next one begins.
 * 
 */

function processQueue() {
    // If a request is already being processed or queue is empty then do nothing and return immediately.
    if (isProcessing || requestQueue.length === 0) return;

    isProcessing = true;
    // Removes oldest request from the queue
    const { req, res } = requestQueue.shift();
    // Stores a reference to the original res.end() function so we can call it later.
    const originalEnd = res.end;

    // Ensures synchronous sequencing of requests 
    res.end = function(...args) {
        // Calls original res.end() with the response data
        originalEnd.apply(res, args);
        isProcessing = false;
        // Schedule next request in the queue (if any) and do it immediately after the current event loop tick
        process.nextTick(processQueue);
    };
    // Handle the actual request by triggering it (GET, POST, etc)
    handleRequest(req, res);
}

/**
 * 
 * Builds the Google OAuth 2.0 authorization URL, which is used to redirect users to Google's login and consent screen.
 * 
 */
function generateOAuthURL() {
    // Base URL for Google OAuth 2.0 authorization endpoint
    const base = 'https://accounts.google.com/o/oauth2/v2/auth';
    // Creates URL Search Params object with the following parameters
    const params = new URLSearchParams({
        client_id, // Identifies app to Google
        redirect_uri, // Where Google sends the user after login with a code
        response_type: 'code', // Requesting an authorization code, not a token directly
        scope: 'https://www.googleapis.com/auth/drive', // What permissions I'm requesting. In this case, Google Drive.
        access_type: 'offline', 
        prompt: 'consent' // Forces the user to see the consent screen everytime it's called on.
    });
    return `${base}?${params.toString()}`; // Converts parameters into a query string to return the final OAuth URL to redirect users.
}

/**
 * 
 * Function that makes HTTPS API calls and returns parsed JSON via a callback that strictly avoids
 * asynchronous methods.
 * 
 */

function makeRequest(options, postData, callback) {
    console.log(`Starting API call to ${options.hostname}${options.path}`);
    // Start an HTTPS request with the provided options
    const req = https.request(options, res => {
        // Buffer to collect response data
        let result = '';
        // Listen for data chunks from the resposne
        res.on('data', chunk => result += chunk);
        //Once all data is received, try to parse it and invoke the callback
        res.on('end', () => {
            try {
                // Parse JSON and return it
                callback(null, JSON.parse(result));
            } catch (error) {
                // If parsing fails, return the error
                callback(error);
            }
        });
    });
    // Handle request-level errors (i.e., network issues)
    req.on('error', callback);
    // If there's POST data, write it to the request body
    if (postData) req.write(postData);
    // Finalize and send the request
    req.end();
}

function getAccessToken(code, callback) {
    // Prepare POST data for exchanging the authorization code for an access token
    const postData = querystring.stringify({
        code, // Authorization code received from Google
        client_id, // My own Google app client ID
        client_secret, // My own Google app client secret code
        redirect_uri, // Matches OAuth request
        grant_type: 'authorization_code' // Grant type for code exchange
    });
    
    // Define the HTTP request options for the token endpoint
    const options = {
        hostname: 'oauth2.googleapis.com', // Google OAuth2 token server
        path: '/token', // Endpoint for exchanging auth code
        method: 'POST', // Token exchange requires POST
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded', // URL-encoded body
            'Content-Length': postData.length 
        }
    };

    // Perform the HTTPS request to get the token
    makeRequest(options, postData, (err, response) => {
        if (err) return callback(err); // If a request failed, propagate error
        access_token = response.access_token; // Store the access token globally
        console.log('Access token received'); 
        callback(null); // Notify completion
    });
}

function callMetAPI(keyword, callback) {
    // Construct the first request which searches for artworks with images matching the user keyword
    const searchOptions = {
        method: 'GET',
        hostname: 'collectionapi.metmuseum.org',
        path: '/public/collection/v1/search?hasImages=true&q=' + encodeURIComponent(keyword)
    };

    // Make the search request to the MET API
    makeRequest(searchOptions, null, (err, searchResults) => {
        // If there's an error or no results, stop and return null to the callback
        if (err || searchResults.total === 0) return callback(null);

        // List of matching artwork IDs
        const objectIDs = searchResults.objectIDs;
        // Picks one at random of those artwork IDs
        const randomID = objectIDs[Math.floor(Math.random() * objectIDs.length)];

        // Construct the second request to get detailed data for that specific artwork ID
        const objectOptions = {
            method: 'GET',
            hostname: 'collectionapi.metmuseum.org',
            path: '/public/collection/v1/objects/' + randomID
        };

        // Request the artwork details
        makeRequest(objectOptions, null, (err, objectData) => {
            if (err) return callback(null); // If failed, return null
            callback(objectData); // Return the object data
        });
    });
}

function uploadToDrive(data, folderId, callback) {
    const imageUrl = data.primaryImageSmall; // Get image URL from artwork data
    const imageOptions = url.parse(imageUrl); // Parse it into an options object
    imageOptions.method = 'GET'; // Set HTTP method to GET for downloading

    // Download the image from the MET API
    https.request(imageOptions, (imageRes) => {
        const chunks = []; // Array to store data chunks
        imageRes.on('data', (chunk) => chunks.push(chunk)); // Collect data as it streams
        
        imageRes.on('end', () => {
            const imageBuffer = Buffer.concat(chunks); // Combine all chunks into a single buffer
            
            // Set metadata for the image file to be uploaded to Google Drive
            const imageMetadata = {
                name: `${data.title || 'Artwork'}.jpg`, // Use artwork title or just Artwork
                mimeType: 'image/jpeg', // Indicate it's a JPEG Image
                parents: [folderId] // Put it in the specified Drive folder
            };
            
            // Upload the image file to Google Drive
            uploadFileToDrive(imageMetadata, imageBuffer, 'image/jpeg', (err, imageFile) => {
                if (err) return callback(err); // If image upload fails, exit early
                
                // Prepare metadata for accompanying test file
                const textMetadata = {
                    name: `${data.title || 'Artwork'}.txt`, // Text file named after the artwork
                    mimeType: 'text/plain', // Text file
                    parents: [folderId] // Same folder as the image
                };
                
                // Generate the content of the text file with artwork metadata
                const textContent = `Title: ${data.title}\n` +
                                   `Artist: ${data.artist}\n` +
                                   `Date: ${data.objectDate}\n` +
                                   `Department: ${data.department}\n` +
                                   `Image URL: https://drive.google.com/file/d/${imageFile.id}/view`;
                // Upload text file to Google Drive
                uploadFileToDrive(textMetadata, textContent, 'text/plain', callback);
            });
        });
    }).end();
}

function uploadFileToDrive(metadata, fileData, mimeType, callback) {
    const boundary = '-------314159265358979323846'; // Boundary string for multipart data
    const delimiter = "\r\n--" + boundary + "\r\n"; // Delimiter between parts
    const close_delim = "\r\n--" + boundary + "--"; // Final boundary marker
    
    // Handle both text and binary data
    const contentPart = mimeType === 'image/jpeg' 
        ? fileData // Use binary buffer directly for images
        : Buffer.from(fileData, 'utf8'); // Convert text to buffer

    // Construct the multipart data in order to upload JSON metadata part and file content part
    const body = Buffer.concat([
        Buffer.from(delimiter, 'utf8'), // Start delimiter
        Buffer.from('Content-Type: application/json\r\n\r\n', 'utf8'), // Header for metadata part
        Buffer.from(JSON.stringify(metadata), 'utf8'), // Actual metadata JSON
        Buffer.from(delimiter, 'utf8'), // Delimiter before file part
        Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`, 'utf8'), // Header for file part
        contentPart, // Actual file data
        Buffer.from(close_delim, 'utf8') // Closing delimiter 
    ]);

    // Set up HTTPS request options for the Google Drive API
    const options = {
        hostname: 'www.googleapis.com',
        path: '/upload/drive/v3/files?uploadType=multipart', // Endpoint for multipart upload
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${access_token}`, // OAuth access token for Drive
            'Content-Type': `multipart/related; boundary=${boundary}`, // Specify multipart type
            'Content-Length': body.length // Total body length
        },
        family: 4 // Force IPv4
    };
    // Make HTTPS request using the helper function once upload compeltes
    makeRequest(options, body, callback);
}

function ensureDriveFolder(callback) {
    const folderName = 'MET Artworks'; // Name created for the folder in Google Drive
    // Checks if we already have the folder ID from a previous request so it doesn't create it again
    if (fs.existsSync('folder_id.txt')) {
        // If the file exists, read the folder ID from it
        const folderId = fs.readFileSync('folder_id.txt', 'utf8').trim();
        // Returnt he cached folder ID via callback
        return callback(null, folderId); 
    }
    // If folder ID doesn't exist, we create a new folder in Google Drive
    const metadata = {
        name: folderName, // Folder name in Google Drive
        mimeType: 'application/vnd.google-apps.folder' // MIME type to create a folder
    };

    // Convert metadata to JSON string
    const body = JSON.stringify(metadata);
  
    const options = {
        hostname: 'www.googleapis.com',
        path: '/drive/v3/files', // Google Drive API endpoint to create new files/folders
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${access_token}`, // Include the OAuth access token
            'Content-Type': 'application/json', // Sending JSON
            'Content-Length': Buffer.byteLength(body) // Set the request body length
        }
    };

    // Make the HTTPS POST request to create the foldrer
    makeRequest(options, body, (err, response) => {
        if (err) return callback(err); // If error occurs, pass it to callback
        const folderId = response.id; // Extract new created folder ID from response 
        fs.writeFileSync('folder_id.txt', folderId); // Save folder ID to a file for future runs to avoid creating duplicates
        callback(null, folderId); // Return the folder ID via callback
    });
}

function handleRequest(req, res) {
    // Parse the URL and query parameters
    const parsedUrl = url.parse(req.url);
    const qs = querystring.parse(parsedUrl.query);

    // Serve the homepage with a form and auth link
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <form method="POST" action="/search">
                <label>Search MET Artworks:</label>
                <input type="text" name="keyword" required />
                <button type="submit">Search</button>
            </form>
            <p><a href="/auth">Login to Google</a> first.</p>
        `);
    // Redirect user to Google's OAuth Page
    } else if (req.url.startsWith('/auth')) {
        res.writeHead(302, { Location: generateOAuthURL() }); // Redirects to Google login
        res.end();
    // Handle the OAuth callback and exchange the code for a token
    } else if (req.url.startsWith('/oauth2callback')) {
        const { code } = qs; // Get auth code from query string
        getAccessToken(code, (err) => { // Exchange code for access token
            // In the event that the authentication didn't pass
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end('<h1>Authentication failed. Please try again.</h1>');
                return;
            }
            // Resposne once proper authentication has been made
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authenticated! Go back to the original homepage.</h1>');
        });
    // Handle POST request from the artwork search form
    } else if (req.method === 'POST' && req.url === '/search') {
        let body = ''; // This accumulates the incoming POST data chunks
        req.on('data', chunk => body += chunk); // Collect POST body data from request body
        req.on('end', () => { // Once all the data has been received the following happens
            const { keyword } = querystring.parse(body); // Extract 'keyword' field from input form
            // In the event that the user were to request something in the body first and hasn't been authenticated, this would happen
            if (!access_token) {
                res.writeHead(401, { 'Content-Type': 'text/html' });
                res.end('<h1>Please authenticate first: <a href="/auth">Login</a></h1>');
                return;
            }

            // Step 1: Search the MET API for artworks matching the keyword
            callMetAPI(keyword, (artworkData) => {
                // If no matching artwork has been found or an error occurred
                if (!artworkData) {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end('<h1>No results found.</h1>');
                    return;
                }
                // Step 2: Ensure the "MET Artworks" folder exists in Google Drive
                ensureDriveFolder((err, folderId) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'text/html' });
                        res.end('<h1>Failed to ensure folder creation.</h1>');
                        return;
                    }
                    // Step 3: Upload the image and metadata to Google Drive
                    uploadToDrive(artworkData, folderId, (err) => {
                        if (err) {
                            res.writeHead(500, { 'Content-Type': 'text/html' });
                            res.end('<h1>Failed to upload to Google Drive.</h1>');
                            return;
                        }

                        // If upload succeeded, display artwork and confirmation onto the website itself and confirm that it'll be saved to the Google Drive folder
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`
                            <h1>${artworkData.title}</h1>
                            <p>Artist: ${artworkData.artist}</p>
                            <img src="${artworkData.primaryImageSmall}" />
                            <p><strong>Metadata and image uploaded to your Google Drive folder!</strong></p>
                        `);
                    });
                });
            });
        });
    // Catch-all for unknown routes
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
}

// Create a new HTTP server
const server = http.createServer((req, res) => {
    console.log(`New request received for ${req.url}`);
    // Push the incoming request and its response object into the queue which ensures request are not processed immediately, but queued instead
    requestQueue.push({ req, res });
    // Start processing the queue. If another request is already being processed, this call will return immediately and wait for the ongoing one to finish
    processQueue();
});

// Start the server on port 3000 
server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});