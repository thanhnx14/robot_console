"use client";  // This directive ensures the file is treated as a client component

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { JoystickManager, JoystickManagerOptions } from 'nipplejs';
import throttle from 'lodash/throttle';

interface GetResponse {
  value: string;
}

const Home = () => {
  const [joystickData, setJoystickData] = useState({ x: 0, y: 0 });
  const [robotIp, setRobotIp] = useState<string | null>(null);
  const joystickRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fetchRobotIp = async () => {
      try {
        const response = await axios.get<GetResponse>('/api/get?key=robot_ip');
        setRobotIp(response.data.value);
      } catch (error) {
        console.error('Failed to fetch robot_ip:', error);
      }
    };

    fetchRobotIp();
  }, []);

  useEffect(() => {
    if (!robotIp) return;

    const setupJoystick = async () => {
      if (typeof window !== 'undefined') {
        const { default: nipplejs } = await import('nipplejs');

        const webSocket = new WebSocket(`ws://${robotIp}:81`);
        webSocket.onopen = () => {
          console.log('WebSocket connected');
        };
        webSocket.onclose = () => {
          console.log('WebSocket disconnected');
        };
        webSocket.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

        if (joystickRef.current) {
          const options: JoystickManagerOptions = {
            zone: joystickRef.current,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'blue',
            restJoystick: true, // Automatically return to center when released
          };

          const joystick: JoystickManager = nipplejs.create(options);

          const throttledSend = throttle((x: number, y: number) => {
            if (webSocket.readyState === WebSocket.OPEN) {
              webSocket.send(JSON.stringify({ x, y }));
              console.log(JSON.stringify({ x, y }));
            }
          }, 100, { trailing: true });  // Adjust the throttle delay as needed

          joystick.on('move', (evt, data) => {
            const x = data.vector.x * 512 + 512;
            const y = data.vector.y * -512 + 512;
            setJoystickData({ x, y });
            throttledSend(x, y);
          });

          joystick.on('end', () => {
            const x = 512;
            const y = 512;
            setJoystickData({ x, y });

            throttledSend(x, y);
            console.log("end");
          });

          return () => {
            joystick.destroy();
            webSocket.close();
          };
        }
      }
    };

    setupJoystick();
  }, [robotIp]);

  return (
    <div>
      <h1>Motor Control - This is from auto deployment push from develop</h1>
      <div style={{ marginBottom: '20px' }}>
        {robotIp ? (
          <img
            src={`/api/proxy?url=${encodeURIComponent(`http://${robotIp}/`)}`}
            alt="ESP32-CAM Stream"
            width="640"
            height="480"
            style={{ display: 'block', margin: 'auto' }}
          />
        ) : (
          <p>Loading robot IP...</p>
        )}
      </div>
      <div
        id="joystick-wrapper"
        ref={joystickRef}
        style={{ width: '200px', height: '200px', margin: 'auto' }}
      ></div>
      <p>Joystick X: {Math.round(joystickData.x)} | Joystick Y: {Math.round(joystickData.y)}</p>
    </div>
  );
};

export default Home;
