import { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';

let socketSend: Socket;

const Capture: React.FC = () => {
  const [errors, setErrors] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fps, setFps] = useState(0);

  const FPS = 20; // Configure the FPS (frames per second)
  const FRAME_INTERVAL = 1000 / FPS; // Calculate the interval in milliseconds

  useEffect(() => {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      setErrors((prevErrors) => [...prevErrors, ...args.map(arg => arg.toString())]);
      originalConsoleError.apply(console, args);
    };

    const startVideo = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 640, height: 640, facingMode: 'environment' }
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        } else {
          console.error('Video element not found');
        }
      } catch (error) {
        console.error('Error accessing camera: ', error);
      }
    };

    startVideo();

    socketSend = io({
      path: '/api/send-image'
    });

    socketSend.on('connect', () => {
      console.log('Connected to send-image WebSocket');
    });

    socketSend.on('disconnect', () => {
      console.log('Disconnected from send-image WebSocket');
    });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const targetWidth = 640;
    const targetHeight = 640;

    let frameCount = 0;
    let startTime = Date.now();

    const captureInterval = setInterval(() => {
      // const captureStartTime = Date.now();
      if (context && videoRef.current) {
        const videoWidth = videoRef.current.videoWidth;
        const videoHeight = videoRef.current.videoHeight;

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        context.drawImage(
          videoRef.current,
          0, 0, videoWidth, videoHeight, // Source dimensions
          0, 0, targetWidth, targetHeight // Destination dimensions
        );

        canvas.toBlob((blob) => {
          if (blob) {
            const reader = new FileReader();
            const timestamp = Date.now();
            reader.onloadend = () => {
              socketSend.timeout(1000).emitWithAck('image', { data: reader.result, timestamp }).then(()=>{
                frameCount++;
              });           
            };
            reader.readAsArrayBuffer(blob);
          }
        }, 'image/jpeg', 1); // Adjust quality as needed

        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= 1000) {
          setFps(frameCount);
          frameCount = 0;
          startTime = Date.now();
        }
      }
    }, 1000 / 60); // Capture at 24 FPS

    return () => {
      if (socketSend) {
        socketSend.disconnect();
      }
      clearInterval(captureInterval);
      console.error = originalConsoleError; // Restore original console.error
    };
  }, []);

  return (
    <div style={{ textAlign: 'center' }}>
      <h1>Capture Page</h1>
      <p>FPS: {fps}</p>
      <video ref={videoRef} autoPlay playsInline style={{ width: '640px', height: '640px' }} />
      <div style={{ color: 'red', marginTop: '20px' }}>
        {errors.map((error, index) => (
          <div key={index}>{error}</div>
        ))}
      </div>
    </div>
  );
};

export default Capture;
