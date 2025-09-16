import { NextApiRequest, NextApiResponse } from 'next';
import { Server as HTTPServer } from 'http';
import { Server as IOServer } from 'socket.io';
import { Socket } from 'net';

interface SocketServer extends HTTPServer {
  io?: IOServer;
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: Socket & {
    server: SocketServer;
  };
}

const SocketHandler = (req: NextApiRequest, res: NextApiResponseWithSocket) => {
  if (res.socket.server.io) {
    console.log('Socket is already running');
  } else {
    console.log('Socket is initializing');
    const io = new IOServer(res.socket.server as HTTPServer,{ path: '/api/socket' });
    res.socket.server.io = io;

    io.on('connection', (socket) => {
      console.log('Client connected');

      socket.on('image', (data) => { console.log('Received image'); socket.broadcast.emit('image', data); });
      socket.on('input-change', (msg) => {
        socket.broadcast.emit('update-input', msg);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected');
      });
    });
  }

  res.end();
};

export default SocketHandler;
