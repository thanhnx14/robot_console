import { NextApiRequest, NextApiResponse } from 'next';
import { getStore } from '../../lib/store';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { key, value } = req.query;
    const store = getStore();

    if (typeof key === 'string' && typeof value === 'string') {
      store[key] = value;
      res.status(200).json({ message: 'Key-Value pair stored successfully', store });
    } else {
      res.status(400).json({ message: 'Key and value are required' });
    }
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}
