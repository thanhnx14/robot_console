import { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';

let socketDisplay: Socket;

const Display: React.FC = () => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frameCount = 0;
    let startTime = Date.now();

    socketDisplay = io({
      path: '/api/display-image'
    });

    socketDisplay.on('connect', () => {
      console.log('Connected to display-image WebSocket');
    });

    socketDisplay.on('image', (data: ArrayBuffer) => {
      const blob = new Blob([new Uint8Array(data)], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      if (imgRef.current) {
        imgRef.current.src = url;
      }

      // Count the frames and calculate FPS
      frameCount++;
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        startTime = Date.now();
      }
    });

    socketDisplay.on('disconnect', () => {
      console.log('Disconnected from display-image WebSocket');
    });

    return () => {
      if (socketDisplay) {
        socketDisplay.disconnect();
      }
    };
  }, []);

  return (
    <div style={{ textAlign: 'center' }}>
      <h1>Live Stream</h1>
      <p>FPS: {fps}</p>
      <img ref={imgRef} alt="Live Stream" style={{ width: '100%', maxWidth: '480px', height: 'auto' }} />
    </div>
  );
};

export default Display;
