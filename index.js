const express = require('express');
const axios = require('axios');
const cors = require('cors');
const ytdl = require('ytdl-core');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Function to search YouTube using scraping technique
const searchYouTube = async (query) => {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    // Extract initial data from the page
    const data = response.data;
    const startTag = 'var ytInitialData = ';
    const startIndex = data.indexOf(startTag);

    if (startIndex === -1) {
      throw new Error('Could not find initial data in the YouTube page');
    }

    let endIndex = data.indexOf(';</script>', startIndex);
    const jsonStr = data.substring(startIndex + startTag.length, endIndex);

    // Parse the JSON data
    const ytData = JSON.parse(jsonStr);

    // Extract video information from the response
    const contents = ytData.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;

    // Filter out ads and non-video content
    const videos = contents
      .filter(item => item.videoRenderer)
      .map(item => {
        const videoData = item.videoRenderer;
        const baseUrl = `http://localhost:${PORT}`; // Change this to your actual domain in production

        return {
          title: videoData.title.runs[0].text,
          thumbnail: videoData.thumbnail.thumbnails[videoData.thumbnail.thumbnails.length - 1].url,
          channel: videoData.ownerText.runs[0].text,
          views: videoData.viewCountText ? videoData.viewCountText.simpleText : 'No view data',
          description: videoData.detailedMetadataSnippets ? 
                      videoData.detailedMetadataSnippets[0].snippetText.runs.map(r => r.text).join('') : 
                      'No description available',
          published: videoData.publishedTimeText ? videoData.publishedTimeText.simpleText : 'No date data',
          videoUrl: `https://www.youtube.com/watch?v=${videoData.videoId}`,
          downloadLink: `${baseUrl}/download/${videoData.videoId}` // Direct download link
        };
      });

    return videos;
  } catch (error) {
    console.error('Error fetching YouTube data:', error);
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

// Direct download endpoint with automatic download
app.get('/download/:videoId', async (req, res) => {
  const videoId = req.params.videoId;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  try {
    const info = await ytdl.getInfo(videoId);

    // Get the best quality format with both audio and video
    const format = ytdl.chooseFormat(info.formats, { 
      quality: 'highest',
      filter: 'audioandvideo' 
    });

    if (!format) {
      // Fallback to 360p if no format with both audio and video is found
      const fallbackFormat = ytdl.chooseFormat(info.formats, { quality: '18' });
      if (!fallbackFormat) {
        return res.status(404).json({ error: 'No suitable format found' });
      }
    }

    // Clean the title to create a valid filename
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');

    // Set headers for file download
    res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
    res.header('Content-Type', 'video/mp4');

    // Stream the video directly to the client
    ytdl(videoId, { 
      format: format,
      quality: 'highest'
    }).pipe(res);

  } catch (error) {
    console.error('Error downloading video:', error);
    res.status(500).json({ 
      error: 'Failed to download video',
      message: error.message
    });
  }
});

// Home route with API documentation
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>YouTube Search and Download API</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #ff0000; }
          code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
          pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <h1>YouTube Search and Download API</h1>
        <p>Use this API to search YouTube videos and download them directly.</p>

        <h2>Endpoints:</h2>
        <ul>
          <li><code>GET /api/search?q=your+search+query</code> - Search for videos</li>
          <li><code>GET /download/:videoId</code> - Direct download link for a video</li>
        </ul>

        <h2>Example Response Format:</h2>
        <pre>{
  "query": "example search",
  "results": [
    {
      "title": "Example Video Title",
      "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "channel": "Example Channel",
      "views": "1.2B views",
      "description": "This is an example video description",
      "published": "10 years ago",
      "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "downloadLink": "http://localhost:3000/download/dQw4w9WgXcQ"
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
  console.log(`API endpoint: http://localhost:${PORT}/api/search?q=yourquery`);
});