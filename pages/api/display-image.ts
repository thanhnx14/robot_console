import { NextApiRequest, NextApiResponse } from 'next';
import { Server as HTTPServer } from 'http';
import { Server as IOServer } from 'socket.io';
import { Socket } from 'net';
import imageQueue from '../../lib/globals';

interface SocketServer extends HTTPServer {
  ioDisplay?: IOServer;
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: Socket & {
    server: SocketServer;
  };
}

const FPS = 20; // Configure the FPS (frames per second)
const FRAME_INTERVAL = 1000 / FPS; // Calculate the interval in milliseconds

const SocketHandler = (req: NextApiRequest, res: NextApiResponseWithSocket) => {
  if (res.socket.server.ioDisplay) {
    console.log('Socket.IO server for display-image already running');
  } else {
    console.log('Socket is initializing');
    const ioDisplay = new IOServer(res.socket.server as HTTPServer, { path: '/api/display-image' });
    res.socket.server.ioDisplay = ioDisplay;

    ioDisplay.on('connection', async (socket) => {
      console.log('Client connected to display-image');
      let isActive = true;

      socket.on('disconnect', () => {
        isActive = false;
        console.log('Client disconnected from display-image');
      });

      // Function to send images at a configured FPS
      const sendImagesAtFPS = async () => {
        while (isActive) {
          const startTime = Date.now();
          const image = await imageQueue.dequeue();
          if (image) {
            socket.emit('image', image.data);
          }

          const elapsedTime = Date.now() - startTime;
          const waitTime = FRAME_INTERVAL - elapsedTime;
          if (waitTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
      };

      sendImagesAtFPS(); // Start sending images
    });

    console.log('Socket.IO server for display-image initialized');
  }

  res.end();
};

export default SocketHandler;
