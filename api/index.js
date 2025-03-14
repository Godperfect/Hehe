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
          videoId: videoData.videoId,
          // Offer both download options
          downloadMp4: `/api/download?videoId=${videoData.videoId}&format=mp4`,
          downloadMp3: `/api/download?videoId=${videoData.videoId}&format=mp3`,
          // Direct download options
          directMp4: `/api/direct-download?videoId=${videoData.videoId}&format=mp4`,
          directMp3: `/api/direct-download?videoId=${videoData.videoId}&format=mp3`
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

// Improved download endpoint with format selection
app.get('/api/download', async (req, res) => {
  const videoId = req.query.videoId;
  const format = req.query.format || 'mp4'; // Allow format selection (mp4/mp3)

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  try {
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);

    let formatUrl;

    if (format === 'mp3') {
      // For MP3, get highest audio quality
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      if (audioFormats.length === 0) {
        return res.status(404).json({ error: 'No audio format found' });
      }

      // Sort by audio bitrate (higher is better)
      const bestAudio = audioFormats.sort((a, b) => b.audioBitrate - a.audioBitrate)[0];
      formatUrl = bestAudio.url;
    } else {
      // For MP4, get format with both video and audio
      const videoFormats = ytdl.filterFormats(info.formats, 'videoandaudio');

      if (videoFormats.length === 0) {
        return res.status(404).json({ error: 'No combined video/audio format found' });
      }

      // Sort by quality - convert quality label to numeric value for proper sorting
      const getBitrateValue = (format) => {
        if (!format.qualityLabel) return 0;
        const match = format.qualityLabel.match(/(\d+)p/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const bestVideo = videoFormats.sort((a, b) => getBitrateValue(b) - getBitrateValue(a))[0];
      formatUrl = bestVideo.url;
    }

    if (!formatUrl) {
      return res.status(404).json({ error: 'No suitable URL found' });
    }

    // Redirect to the media URL
    console.log(`Redirecting to: ${formatUrl.substring(0, 100)}...`); // Log for debugging
    res.redirect(formatUrl);

  } catch (error) {
    console.error('Error getting video URL:', error);
    res.status(500).json({ 
      error: 'Failed to get video URL',
      message: `Status code: ${error.statusCode || error.status || 'unknown'}, Message: ${error.message}`
    });
  }
});

// Direct download endpoint that streams the content
app.get('/api/direct-download', async (req, res) => {
  const videoId = req.query.videoId;
  const format = req.query.format || 'mp4';

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID is required' });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await ytdl.getInfo(videoUrl);

    // Set filename from video title
    const sanitizedTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');

    if (format === 'mp3') {
      // Set proper headers for audio download
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.mp3"`);
      res.setHeader('Content-Type', 'audio/mpeg');

      // Stream audio only
      ytdl(videoUrl, {
        quality: 'highestaudio',
        filter: 'audioonly',
      }).pipe(res);
    } else {
      // Set proper headers for video download
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}.mp4"`);
      res.setHeader('Content-Type', 'video/mp4');

      // Stream video with audio
      ytdl(videoUrl, {
        quality: 'highest',
        filter: 'audioandvideo',
      }).pipe(res);
    }
  } catch (error) {
    console.error('Error streaming video/audio:', error);
    res.status(500).json({ 
      error: 'Failed to stream media',
      message: error.message
    });
  }
});

// Home route with API documentation
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>YouTube Search & Download API</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #ff0000; }
          code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
          pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
          .endpoint { margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <h1>Mr perfect</h1>
        <p>Welcome here ☺️</p>

        <h2>API Endpoints:</h2>

        <div class="endpoint">
          <h3>Search for videos</h3>
          <code>GET /api/search?q=your+search+query</code>
          <p>Search for YouTube videos based on a query</p>
        </div>

        <div class="endpoint">
          <h3>Download via URL Redirection</h3>
          <code>GET /api/download?videoId=VIDEO_ID&format=mp4</code> or 
          <code>GET /api/download?videoId=VIDEO_ID&format=mp3</code>
          <p>Get a direct URL to the video/audio file (redirects to YouTube's servers)</p>
        </div>

        <div class="endpoint">
          <h3>Direct Download (Streaming)</h3>
          <code>GET /api/direct-download?videoId=VIDEO_ID&format=mp4</code> or 
          <code>GET /api/direct-download?videoId=VIDEO_ID&format=mp3</code>
          <p>Stream and download the file directly with proper filename</p>
        </div>

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
      "videoId": "VIDEO_ID",
      "downloadMp4": "/api/download?videoId=VIDEO_ID&format=mp4",
      "downloadMp3": "/api/download?videoId=VIDEO_ID&format=mp3",
      "directMp4": "/api/direct-download?videoId=VIDEO_ID&format=mp4",
      "directMp3": "/api/direct-download?videoId=VIDEO_ID&format=mp3"
    }
  ]
}</pre>
      </body>
    </html>
  `);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Application error:', err);

  // Specific error handling for ytdl-core errors
  if (err.message && err.message.includes('Status code')) {
    const statusMatch = err.message.match(/Status code: (\d+)/);
    const statusCode = statusMatch ? statusMatch[1] : 'unknown';

    return res.status(500).json({
      error: 'YouTube API Error',
      statusCode: statusCode,
      message: err.message
    });
  }

  // General error handling
  res.status(500).json({
    error: 'Server Error',
    message: err.message
  });
});

// For Vercel, export the app as a module
module.exports = app;