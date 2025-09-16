import { NextApiRequest, NextApiResponse } from 'next';
import { Server as HTTPServer } from 'http';
import { Server as IOServer } from 'socket.io';
import { Socket } from 'net';
import imageQueue from '../../lib/globals'; // Adjust the path as necessary
import { ImageItem } from '../../lib/imageQueue'; // Adjust the path as necessary

interface SocketServer extends HTTPServer {
  ioSend?: IOServer;
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: Socket & {
    server: SocketServer;
  };
}
const MAX_AGE = 200;

let sequenceNumber = 0;
let lastPackageTime = 0;
let imageEventCount = 0; // Counter for "image" events

// Function to log the number of "image" events per second
setInterval(() => {
  console.log(`Number of "image" events in the last second: ${imageEventCount}`);
  // imageEventCount = 0; // Reset the counter
}, 1000);

const SocketHandler = (req: NextApiRequest, res: NextApiResponseWithSocket) => {
  if (res.socket.server.ioSend) {
    console.log('Socket.IO server for send-image already running');
  } else {
    console.log('Socket is initializing');
    const ioSend = new IOServer(res.socket.server as HTTPServer, { path: '/api/send-image' });
    res.socket.server.ioSend = ioSend;

    ioSend.on('connection', (socket) => {
      console.log('Client connected to send-image');

      socket.on('image', async (data, callback) => {
        imageEventCount++;
        const currentTime = Date.now();
        if (data.timestamp < lastPackageTime || currentTime - data.timestamp  > MAX_AGE) {
          console.log(`Skip frame! Package ${data.timestamp}, last package ${currentTime - data.timestamp} , current time: ${currentTime}`);
          callback('Skip frame');
          imageEventCount--;
          return;
        }
        lastPackageTime = data.timestamp;
        const buffer = Buffer.from(data.data);

        // Enqueue image data with sequence number
        const imageItem: ImageItem = { timestamp: data.timestamp, sequence: sequenceNumber++, data: buffer };
        await imageQueue.enqueue(imageItem);
        callback('OK');
        imageEventCount--;
        // console.log(`Image added to queue with timestamp ${data.timestamp} and sequence ${imageItem.sequence}`);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected from send-image');
      });
    });

    console.log('Socket.IO server for send-image initialized');
  }

  res.end();
};

export default SocketHandler;
