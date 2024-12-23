import { NextApiRequest, NextApiResponse } from 'next';
import { getStore } from '../../lib/store';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { key } = req.query;
    const store = getStore();

    if (typeof key === 'string' && key in store) {
      res.status(200).json({ value: store[key] });
    } else {
      res.status(404).json({ message: 'Key not found' });
    }
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}
