// api/index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ytdl = require('ytdl-core');

// Initialize express
const app = express();

// Enable CORS
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
          downloadLink: `/api/download?videoId=${videoData.videoId}` // Direct download link
        };
      });
    
    return videos;
  } catch (error) {
    console.error('Error fetching YouTube data:', error);
    throw error;
  }
};

// Search endpoint
app.get('/api/search', async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const videos = await searchYouTube(query);
    
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

// Download endpoint - modified to work with Vercel
app.get('/api/download', async (req, res) => {
  const videoId = req.query.videoId;
  
  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }
  
  try {
    const info = await ytdl.getInfo(videoId);
    
    // Get the highest quality format with both audio and video
    const formats = ytdl.filterFormats(info.formats, 'videoandaudio');
    const format = formats.sort((a, b) => b.qualityLabel - a.qualityLabel)[0];
    
    if (!format) {
      return res.status(404).json({ error: 'No suitable format found' });
    }
    
    // Instead of streaming (which doesn't work well in serverless environments),
    // redirect to the video URL
    res.redirect(format.url);
      
  } catch (error) {
    console.error('Error getting video URL:', error);
    res.status(500).json({ 
      error: 'Failed to get video URL',
      message: error.message
    });
  }
});

// Home route with API documentation
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>YouTube Search API</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #ff0000; }
          code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
          pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
        </style>
      </head>
      <body>
        <h1>YouTube Search API</h1>
        <p>Use this API to search for YouTube videos and get download links.</p>
        
        <h2>Endpoints:</h2>
        <ul>
          <li><code>GET /api/search?q=your+search+query</code> - Search for videos</li>
          <li><code>GET /api/download?videoId=VIDEO_ID</code> - Download a specific video</li>
        </ul>
        
        <h2>Example Response:</h2>
        <pre>{
  "query": "example search",
  "results": [
    {
      "title": "Example Video",
      "thumbnail": "https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg",
      "channel": "Example Channel",
      "views": "1M views",
      "description": "This is an example video description",
      "published": "2 years ago",
      "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
      "downloadLink": "/api/download?videoId=VIDEO_ID"
    }
  ]
}</pre>
      </body>
    </html>
  `);
});

// For Vercel, export the app as a module
module.exports = app;