// Contract: https://cloudinary.com/documentation/image_upload_api_reference
// This mock deliberately models an upstream outage, not successful storage.
const http = require('http');
http.createServer((req, res) => {
  if (req.url.includes('/image/upload') || req.url.includes('/image/destroy') || req.url.includes('/image/download') || req.url.includes('/video/upload') || req.url.includes('/video/destroy')) {
    req.resume();
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Simulated storage outage' } }));
  } else {
    res.writeHead(501, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Endpoint not modeled' } }));
  }
}).listen(process.env.PORT || 4901);
