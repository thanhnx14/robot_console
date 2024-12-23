import type { NextApiRequest, NextApiResponse } from 'next';
import http from 'http';
import https from 'https';
import { URL } from 'url';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ message: 'URL is required and must be a string' });
    return;
  }

  try {
    const targetUrl = new URL(url);

    const protocol = targetUrl.protocol === 'https:' ? https : http;
    const proxyReq = protocol.request(targetUrl, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        res.status(proxyRes.statusCode || 500).end();
        return;
      }

      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream');
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      const error = err as Error;
      console.error('Proxy request error:', error);
      res.status(500).json({ message: 'Error fetching the resource', error: error.message });
    });

    req.pipe(proxyReq, { end: true });
  } catch (err) {
    const error = err as Error;
    console.error('Error in proxy handler:', error);
    res.status(500).json({ message: 'Error processing the request', error: error.message });
  }
}

export const config = {
  api: {
    bodyParser: false, // Disable body parsing so the proxy works correctly
  },
};
