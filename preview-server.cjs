'use strict';

// Run: node Tools/BeadPattern/preview-server.cjs
// /test-export redirects to a generated, validated game-export example.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const pageFile = path.join(__dirname, 'index.html');
const origin = 'http://127.0.0.1:8765';

http.createServer((request, response) => {
  try {
    const pathname = new URL(request.url, origin).pathname;
    if (!['/', '/index.html', '/test-export'].includes(pathname)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const html = fs.readFileSync(pageFile, 'utf8');
    if (pathname === '/test-export') {
      const pattern = html.match(/function demo\(\)\s*\{[\s\S]*?const pattern='([0-9A-G]+)'/)?.[1];
      if (!pattern || pattern.length !== 1024) throw new Error('Invalid example template');
      const url = new URL(origin);
      url.hash = new URLSearchParams({ export: '1', pattern, style: 'holes', name: 'Cream Kitten' }).toString();
      response.writeHead(302, { Location: url.href, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  } catch (error) {
    console.error(error.message);
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Could not prepare the local preview.');
  }
}).listen(8765, '127.0.0.1', () => {
  console.log(`Preview: ${origin}/`);
  console.log(`Export test: ${origin}/test-export`);
});
