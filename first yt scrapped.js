const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// YouTube Internal API URLs
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_VIDEO_URL = 'https://www.googleapis.com/youtube/v3/videos';

// Function to search YouTube using a more reliable approach
const searchYouTube = async (query) => {
  try {
    // Alternative approach using scraping technique
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      }
    });

    // Extract initial data from the page
    const data = response.data;
    const startTag = 'var ytInitialData = ';
    const startIndex = data.indexOf(startTag);

    if (startIndex === -1) {
      throw new Error('Could not find initial data in the YouTube page');
    }

    let endIndex = data.indexOf('</script>', startIndex);
    const jsonStr = data.substring(startIndex + startTag.length, endIndex - 1);

    // Parse the JSON data
    const ytData = JSON.parse(jsonStr);

    // Extract video information from the response
    const contents = ytData.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;

    // Filter out ads and non-video content
    const videos = contents
      .filter(item => item.videoRenderer)
      .map(item => {
        const videoData = item.videoRenderer;
        return {
          title: videoData.title.runs[0].text,
          videoId: videoData.videoId,
          description: videoData.detailedMetadataSnippets ? 
                      videoData.detailedMetadataSnippets[0].snippetText.runs.map(r => r.text).join('') : 
                      'No description available',
          thumbnail: videoData.thumbnail.thumbnails[videoData.thumbnail.thumbnails.length - 1].url,
          duration: videoData.lengthText ? videoData.lengthText.simpleText : 'Live',
          views: videoData.viewCountText ? videoData.viewCountText.simpleText : 'No view data',
          published: videoData.publishedTimeText ? videoData.publishedTimeText.simpleText : 'No date data',
          channel: videoData.ownerText.runs[0].text,
          channelId: videoData.ownerText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url.split('/')[2],
          videoUrl: `https://www.youtube.com/watch?v=${videoData.videoId}`,
          downloadLinks: {
            video: `https://www.yt-download.org/api/button/videos/${videoData.videoId}`,
            audio: `https://www.yt-download.org/api/button/mp3/${videoData.videoId}`,
            // Note: These are just URL formats for sites that offer YouTube downloads
            // The actual download functionality would be handled by these external services
          }
        };
      });

    return videos;
  } catch (error) {
    console.error('Error fetching YouTube data:', error);
    throw error;
  }
};

// Endpoint to get video details by ID (for additional information)
const getVideoDetails = async (videoId) => {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const response = await axios.get(watchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      }
    });

    // Extract initial data from the page
    const data = response.data;
    const startTag = 'var ytInitialPlayerResponse = ';
    const startIndex = data.indexOf(startTag);

    if (startIndex === -1) {
      throw new Error('Could not find initial data in the YouTube page');
    }

    let endIndex = data.indexOf(';</script>', startIndex);
    const jsonStr = data.substring(startIndex + startTag.length, endIndex);

    // Parse the JSON data
    const videoData = JSON.parse(jsonStr);

    return {
      title: videoData.videoDetails.title,
      description: videoData.videoDetails.shortDescription,
      viewCount: videoData.videoDetails.viewCount,
      lengthSeconds: videoData.videoDetails.lengthSeconds,
      channelId: videoData.videoDetails.channelId,
      channelName: videoData.videoDetails.author,
      thumbnail: videoData.videoDetails.thumbnail.thumbnails[videoData.videoDetails.thumbnail.thumbnails.length - 1].url,
      downloadLinks: {
        video: `https://www.yt-download.org/api/button/videos/${videoId}`,
        audio: `https://www.yt-download.org/api/button/mp3/${videoId}`,
        // These are just example URLs, not functional endpoints
      }
    };
  } catch (error) {
    console.error('Error fetching video details:', error);
    throw error;
  }
};

// REST API endpoint to search YouTube
app.get('/api/search', async (req, res) => {
  const query = req.query.q; // Get query from request

  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    const videos = await searchYouTube(query);

    if (videos.length === 0) {
      return res.status(404).json({ message: 'No videos found' });
    }

    res.json({
      query: query,
      results: videos
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to search YouTube',
      message: error.message
    });
  }
});

// REST API endpoint to get video details
app.get('/api/video/:videoId', async (req, res) => {
  const videoId = req.params.videoId;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  try {
    const videoDetails = await getVideoDetails(videoId);
    res.json(videoDetails);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get video details',
      message: error.message
    });
  }
});

// Home route
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>YouTube Scraper API</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #ff0000; }
          code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
          pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <h1>YouTube Scraper API</h1>
        <p>Use this API to search YouTube videos and get detailed information.</p>

        <h2>Endpoints:</h2>
        <ul>
          <li><code>GET /api/search?q=your+search+query</code> - Search for videos</li>
          <li><code>GET /api/video/:videoId</code> - Get detailed information about a specific video</li>
        </ul>

        <h2>Example Search Response:</h2>
        <pre>{
  "query": "example search",
  "results": [
    {
      "title": "Example Video Title",
      "videoId": "dQw4w9WgXcQ",
      "description": "This is an example video description",
      "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "duration": "3:32",
      "views": "1.2B views",
      "published": "10 years ago",
      "channel": "Example Channel",
      "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "downloadLinks": {
        "video": "https://www.yt-download.org/api/button/videos/dQw4w9WgXcQ",
        "audio": "https://www.yt-download.org/api/button/mp3/dQw4w9WgXcQ"
      }
    }
  ]
}</pre>
      </body>
    </html>
  `);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});