"use client";

import { useEffect, useState } from 'react';
import io, { Socket } from 'socket.io-client';

let socket: Socket;

const Home: React.FC = () => {
  const [input, setInput] = useState('');

  useEffect(() => {
    const socketInitializer = async () => {
      // await fetch('/api/socket');
      socket = io('/' ,{path: '/api/socket'});

      socket.on('connect', () => {
        console.log('connected');
      });

      socket.on('update-input', (msg: string) => {
        setInput(msg);
      });

      socket.on('disconnect', () => {
        console.log('disconnected');
      });
    };

    socketInitializer();

    // Clean-up function to disconnect the socket when the component unmounts
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  const onChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    socket.emit('input-change', e.target.value);
  };

  return (
    <input
      placeholder="Type something"
      value={input}
      onChange={onChangeHandler}
    />
  );
};

export default Home;
