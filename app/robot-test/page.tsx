"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { JoystickManager, JoystickManagerOptions } from 'nipplejs';
import throttle from 'lodash/throttle';

// Message types cho giao thức
const MessageType = {
    JSON_COMMAND: 0x03,
    IMAGE_FRAME: 0x01,
};

export default function RobotTestPage() {
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [messages, setMessages] = useState<string[]>([]);
    const [joystickData, setJoystickData] = useState({ x: 0, y: 0 });
    
    // WebSocket config
    const [room] = useState<string>('video_stream_room');
    const [clientId] = useState<string>('web_dashboard_1');
    const ws = useRef<WebSocket | null>(null);
    
    // Joystick ref
    const joystickRef = useRef<HTMLDivElement | null>(null);
    const joystickInstance = useRef<JoystickManager | null>(null);

    // Hàm gửi lệnh JSON qua WebSocket
    const sendCommand = useCallback((channel: string, command: string, payload: any = {}) => {
        if (ws.current?.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket is not open');
            return;
        }

        const message = { channel, command, payload };
        const jsonString = JSON.stringify(message);
        const jsonBuffer = new TextEncoder().encode(jsonString);

        const buffer = new Uint8Array(1 + jsonBuffer.length);
        buffer[0] = MessageType.JSON_COMMAND;
        buffer.set(jsonBuffer, 1);

        ws.current.send(buffer);
        console.log("Sent command:", message);
        setMessages(prev => [...prev, `Sent: ${jsonString}`].slice(-10)); // Giữ 10 message cuối
    }, []);

    // Hàm gửi lệnh điều khiển joystick (throttled)
    const sendJoystickCommand = useRef(
        throttle((x: number, y: number) => {
            if (ws.current?.readyState === WebSocket.OPEN) {
                sendCommand("controller", "MOVE_JOYSTICK", { x, y });
            }
        }, 100, { trailing: true })
    ).current;

    // Lấy WebSocket URL
    const getWebSocketUrl = (room: string, clientId: string): string => {
        const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = typeof window !== 'undefined' ? window.location.host : '';
        if (!host) return '';
        
        // Nếu dùng ws (không phải wss), thay đổi cổng thành 9081
        let finalHost = host;
        if (protocol === 'ws') {
            const hostname = host.split(':')[0]; // Lấy hostname, bỏ cổng cũ
            finalHost = `${hostname}:9081`;
        }
        
        return `${protocol}://${finalHost}/api/ws/${room}/${clientId}`;
    };

    // Setup WebSocket connection
    useEffect(() => {
        const wsUrl = getWebSocketUrl(room, clientId);
        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';

        ws.current = socket;

        socket.onopen = () => {
            setIsConnected(true);
            setMessages(prev => [...prev, "✅ WebSocket Connected"]);
            console.log('WebSocket connected');
        };

        socket.onclose = () => {
            setIsConnected(false);
            setMessages(prev => [...prev, "❌ WebSocket Disconnected"]);
            console.log('WebSocket disconnected');
        };

        socket.onerror = (event) => {
            console.error("WebSocket error:", event);
            setMessages(prev => [...prev, "⚠️ WebSocket Error"]);
        };

        socket.onmessage = (event) => {
            const data = event.data as ArrayBuffer;
            if (data.byteLength < 1) return;

            const view = new DataView(data);
            const msgType = view.getUint8(0);

            if (msgType === MessageType.JSON_COMMAND) {
                const message = JSON.parse(new TextDecoder().decode(data.slice(1)));
                console.log("Received:", message);
                setMessages(prev => [...prev, `Received: ${JSON.stringify(message)}`].slice(-10));
            }
        };

        return () => {
            socket.close();
        };
    }, [room, clientId]);

    // Setup Joystick
    useEffect(() => {
        const setupJoystick = async () => {
            if (typeof window !== 'undefined' && joystickRef.current && !joystickInstance.current) {
                const { default: nipplejs } = await import('nipplejs');

                const options: JoystickManagerOptions = {
                    zone: joystickRef.current,
                    mode: 'static',
                    position: { left: '50%', top: '50%' },
                    color: '#3B82F6',
                    size: 150,
                    restJoystick: true,
                };

                const joystick: JoystickManager = nipplejs.create(options);
                joystickInstance.current = joystick;

                // Xử lý sự kiện move
                joystick.on('move', (evt, data) => {
                    // Chuyển đổi từ vector (-1 to 1) sang range (-100 to 100)
                    const x = Math.round(data.vector.x * 100);
                    const y = Math.round(data.vector.y * 100);
                    
                    setJoystickData({ x, y });
                    sendJoystickCommand(x, y);
                });

                // Xử lý sự kiện end (thả joystick)
                joystick.on('end', () => {
                    setJoystickData({ x: 0, y: 0 });
                    sendJoystickCommand(0, 0);
                });
            }
        };

        setupJoystick();

        return () => {
            if (joystickInstance.current) {
                joystickInstance.current.destroy();
                joystickInstance.current = null;
            }
        };
    }, [sendJoystickCommand]);

    // Test buttons - gửi lệnh thủ công
    const sendTestCommand = (x: number, y: number) => {
        sendCommand("controller", "MOVE_JOYSTICK", { x, y });
        setJoystickData({ x, y });
    };

    return (
        <main style={{ 
            padding: '20px', 
            fontFamily: 'sans-serif', 
            maxWidth: '900px', 
            margin: 'auto',
            backgroundColor: '#f5f5f5',
            minHeight: '100vh'
        }}>
            <h1 style={{ textAlign: 'center', color: '#333' }}>🤖 Robot Joystick Test</h1>

            {/* Connection Status */}
            <div style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                background: 'white',
                border: '1px solid #ddd', 
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
                <h2 style={{ marginTop: 0, fontSize: '18px' }}>📡 Connection Info</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', fontSize: '14px' }}>
                    <span><strong>Status:</strong></span>
                    <span style={{ 
                        color: isConnected ? '#10b981' : '#ef4444', 
                        fontWeight: 'bold' 
                    }}>
                        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
                    </span>
                    
                    <span><strong>Account:</strong></span>
                    <span>{clientId}</span>
                    
                    <span><strong>Room:</strong></span>
                    <span>{room}</span>
                </div>
            </div>

            {/* Joystick Control */}
            <div style={{ 
                marginBottom: '20px', 
                padding: '20px', 
                background: 'white',
                border: '1px solid #ddd', 
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                textAlign: 'center'
            }}>
                <h2 style={{ marginTop: 0, fontSize: '18px' }}>🕹️ Joystick Control</h2>
                
                <div
                    ref={joystickRef}
                    style={{ 
                        width: '200px', 
                        height: '200px', 
                        margin: '20px auto',
                        background: '#f0f0f0',
                        borderRadius: '50%',
                        position: 'relative'
                    }}
                ></div>

                <div style={{ 
                    fontSize: '16px', 
                    fontWeight: 'bold',
                    padding: '10px',
                    background: '#f0f9ff',
                    borderRadius: '6px',
                    display: 'inline-block'
                }}>
                    X: <span style={{ color: '#3B82F6' }}>{joystickData.x}</span> | 
                    Y: <span style={{ color: '#3B82F6' }}>{joystickData.y}</span>
                </div>

                <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
                    X: -100 (trái) đến 100 (phải) | Y: -100 (lùi) đến 100 (tiến)
                </p>
            </div>

            {/* Test Buttons */}
            <div style={{ 
                marginBottom: '20px', 
                padding: '20px', 
                background: 'white',
                border: '1px solid #ddd', 
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
                <h2 style={{ marginTop: 0, fontSize: '18px' }}>🎮 Quick Test Commands</h2>
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(3, 1fr)', 
                    gap: '10px',
                    marginBottom: '10px'
                }}>
                    <button 
                        onClick={() => sendTestCommand(0, 100)} 
                        disabled={!isConnected}
                        style={buttonStyle}
                    >
                        ⬆️ Tiến (100)
                    </button>
                    <button 
                        onClick={() => sendTestCommand(0, 50)} 
                        disabled={!isConnected}
                        style={buttonStyle}
                    >
                        ⬆️ Tiến (50)
                    </button>
                    <button 
                        onClick={() => sendTestCommand(0, 0)} 
                        disabled={!isConnected}
                        style={{...buttonStyle, background: '#ef4444'}}
                    >
                        ⏹️ Dừng
                    </button>
                </div>
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(3, 1fr)', 
                    gap: '10px',
                    marginBottom: '10px'
                }}>
                    <button 
                        onClick={() => sendTestCommand(-100, 0)} 
                        disabled={!isConnected}
                        style={buttonStyle}
                    >
                        ⬅️ Trái (100)
                    </button>
                    <button 
                        onClick={() => sendTestCommand(100, 0)} 
                        disabled={!isConnected}
                        style={buttonStyle}
                    >
                        ➡️ Phải (100)
                    </button>
                    <button 
                        onClick={() => sendTestCommand(0, -100)} 
                        disabled={!isConnected}
                        style={buttonStyle}
                    >
                        ⬇️ Lùi (100)
                    </button>
                </div>
            </div>

            {/* Message Log */}
            <div style={{ 
                padding: '15px', 
                background: 'white',
                border: '1px solid #ddd', 
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
                <h2 style={{ marginTop: 0, fontSize: '18px' }}>📝 Message Log</h2>
                <div style={{ 
                    background: '#1e293b', 
                    color: '#e2e8f0',
                    padding: '15px', 
                    borderRadius: '6px', 
                    maxHeight: '300px',
                    overflowY: 'auto',
                    fontSize: '12px',
                    fontFamily: 'monospace'
                }}>
                    {messages.length === 0 ? (
                        <div style={{ color: '#94a3b8' }}>No messages yet...</div>
                    ) : (
                        messages.map((msg, idx) => (
                            <div key={idx} style={{ marginBottom: '5px', borderBottom: '1px solid #334155', paddingBottom: '5px' }}>
                                {msg}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </main>
    );
}

const buttonStyle: React.CSSProperties = {
    padding: '12px',
    fontSize: '14px',
    background: '#3B82F6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'all 0.2s',
};

