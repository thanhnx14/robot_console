// app/viewer/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';

type Detection = {
    box: {
        pixel: {
            x1: number;
            y1: number;
            x2: number;
            y2: number;
        };
    };
    confidence: number;
    class_id: number;
    class_name: string;
};

const MessageType = {
    JSON_COMMAND: 0x03,
    IMAGE_FRAME: 0x01,
};

const RENDER_FPS = 30;
const INITIAL_TARGET_FPS = 25;
const FEEDBACK_INTERVAL_MS = 2000;

export default function ViewerPage() {
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isReceiving, setIsReceiving] = useState<boolean>(false);
    const [targetFps, setTargetFps] = useState<number>(INITIAL_TARGET_FPS);
    const [receivingFps, setReceivingFps] = useState(0);
    
    const [room] = useState<string>('video_stream_room');
    const [clientId, setClientId] = useState<string>('');
    const ws = useRef<WebSocket | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    const latestPacketRef = useRef<any | null>(null);
    const lastRenderedFrameIdRef = useRef<number>(-1);
    const processingTimesRef = useRef<number[]>([]);
    const receivedFrameCount = useRef(0);

    // Đo FPS
    useEffect(() => {
        const interval = setInterval(() => {
            setReceivingFps(receivedFrameCount.current);
            receivedFrameCount.current = 0;
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    // Vẽ detection box
    const drawSingleDetection = (ctx: CanvasRenderingContext2D, detection: Detection) => {
        const { x1, y1, x2, y2 } = detection.box.pixel;
        const width = x2 - x1;
        const height = y2 - y1;
        
        ctx.strokeStyle = 'lime';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(x1, y1, width, height);
        ctx.stroke();

        const label = `${detection.class_name} (${Math.round(detection.confidence * 100)}%)`;
        ctx.fillStyle = 'lime';
        ctx.font = '16px Arial';
        ctx.textBaseline = 'bottom';

        const textMetrics = ctx.measureText(label);
        const textHeight = 20;
        
        ctx.fillRect(x1, y1 - textHeight, textMetrics.width + 4, textHeight);
        ctx.fillStyle = 'black';
        ctx.fillText(label, x1 + 2, y1);
    };

    // Gửi lệnh JSON
    const sendCommand = useCallback((channel: string, command: string, payload: any = {}) => {
        if (ws.current?.readyState !== WebSocket.OPEN) return;

        const message = { channel, command, payload };
        const jsonString = JSON.stringify(message);
        const jsonBuffer = new TextEncoder().encode(jsonString);

        const buffer = new Uint8Array(1 + jsonBuffer.length);
        buffer[0] = MessageType.JSON_COMMAND;
        buffer.set(jsonBuffer, 1);

        ws.current.send(buffer);
        console.log("Sent command:", message);
    }, []);

    // Lấy WebSocket URL
    const getWebSocketUrl = (room: string, clientId: string): string => {
        const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = typeof window !== 'undefined' ? window.location.host : '';
        if (!host) return '';
        
        let finalHost = host;
        if (protocol === 'ws') {
            const hostname = host.split(':')[0];
            finalHost = `${hostname}:9081`;
        }
        
        return `${protocol}://${finalHost}/api/ws/${room}/${clientId}`;
    };

    // Tạo clientId khi component mount (tránh hydration error)
    useEffect(() => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 9);
        const newClientId = `viewer_${timestamp}_${random}`;
        setClientId(newClientId);
        console.log("Generated clientId:", newClientId);
    }, []);

    // Kết nối WebSocket khi có clientId
    useEffect(() => {
        if (!clientId) return;

        const wsUrl = getWebSocketUrl(room, clientId);
        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';

        ws.current = socket;

        socket.onopen = () => {
            setIsConnected(true);
            console.log("WebSocket connected");
            
            // Tự động gửi lệnh start view
            setTimeout(() => {
                sendCommand("viewer", "START_RECEIVING");
                setIsReceiving(true);
            }, 500);
        };

        socket.onclose = () => {
            setIsConnected(false);
            setIsReceiving(false);
            console.log("WebSocket disconnected");
        };

        socket.onerror = (event) => {
            console.error("WebSocket error:", event);
        };
        
        socket.onmessage = async (event) => {
            const data = event.data as ArrayBuffer;
            if (data.byteLength < 1) return;

            const view = new DataView(data);
            const msgType = view.getUint8(0);

            if (msgType === MessageType.JSON_COMMAND) {
                const message = JSON.parse(new TextDecoder().decode(data.slice(1)));
                if (message.image && message.frameId) {
                    receivedFrameCount.current++;
                    latestPacketRef.current = message;
                } else {
                    console.log("Received message:", message);
                }
            }
        };

        return () => {
            socket.close();
        };
    }, [clientId, room, sendCommand]);

    // Render video frames
    useEffect(() => {
        let renderInterval: NodeJS.Timeout;

        if (isReceiving) {
            renderInterval = setInterval(async () => {
                const latestPacket = latestPacketRef.current;
                if (!latestPacket || latestPacket.frameId <= lastRenderedFrameIdRef.current) {
                    return;
                }
                
                const startTime = performance.now();
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;

                lastRenderedFrameIdRef.current = latestPacket.frameId;

                try {
                    const bytes = new Uint8Array(latestPacket.image.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
                    const imageBlob = new Blob([bytes], { type: 'image/jpeg' });

                    const imageBitmap = await createImageBitmap(imageBlob);
                    canvas.width = imageBitmap.width;
                    canvas.height = imageBitmap.height;
                    ctx.drawImage(imageBitmap, 0, 0);
                    imageBitmap.close();
                    if (latestPacket.ai?.detections) {
                        latestPacket.ai.detections.forEach((detection: Detection) => {
                            drawSingleDetection(ctx, detection);
                        });
                    }
                } catch (error) {
                    console.error("Lỗi khi render frame:", error);
                }
                
                const endTime = performance.now();
                processingTimesRef.current.push(endTime - startTime);
            }, 1000 / RENDER_FPS);
        }

        return () => {
            if (renderInterval) clearInterval(renderInterval);
            lastRenderedFrameIdRef.current = -1;
            latestPacketRef.current = null;
        };
    }, [isReceiving]);

    // Điều chỉnh FPS dựa trên hiệu năng
    useEffect(() => {
        let feedbackInterval: NodeJS.Timeout;
        
        if (isReceiving) {
            feedbackInterval = setInterval(() => {
                const times = processingTimesRef.current;
                if (times.length < 10) return;

                const avgProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;
                processingTimesRef.current = [];

                const renderInterval = 1000 / RENDER_FPS;
                let newTargetFps = targetFps;

                if (avgProcessingTime > renderInterval * 0.8) {
                    newTargetFps = Math.max(10, targetFps - 5);
                } else if (avgProcessingTime < renderInterval * 0.3) {
                    newTargetFps = Math.min(30, targetFps + 3);
                }

                if (newTargetFps !== targetFps) {
                    console.log(`Điều chỉnh FPS: ${targetFps} -> ${newTargetFps}`);
                    setTargetFps(newTargetFps);
                    sendCommand('viewer', 'ADJUST_FPS', { fps: newTargetFps });
                }
            }, FEEDBACK_INTERVAL_MS);
        }

        return () => { if (feedbackInterval) clearInterval(feedbackInterval); };
    }, [isReceiving, targetFps, sendCommand]);

    return (
        <main style={{ 
            padding: '20px', 
            fontFamily: 'sans-serif', 
            minHeight: '100vh',
            background: '#1a1a1a',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        }}>
            <div style={{
                width: '100%',
                maxWidth: '900px', // Giới hạn chiều rộng tối đa trên PC
                background: '#2d2d2d',
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Header */}
                <div style={{ 
                    padding: '15px 20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #444'
                }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '20px', color: '#fff' }}>📹 Video Viewer</h1>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <div style={{ 
                            width: '12px', 
                            height: '12px', 
                            borderRadius: '50%', 
                            background: isConnected ? '#10b981' : '#ef4444',
                            boxShadow: isConnected ? '0 0 10px #10b981' : 'none'
                        }}></div>
                        <span style={{ fontSize: '14px', color: '#999' }}>
                            {isConnected ? 'Đã kết nối' : 'Chưa kết nối'}
                        </span>
                        <span style={{ fontSize: '14px', color: '#3B82F6', fontWeight: 'bold' }}>
                            {receivingFps} FPS
                        </span>
                    </div>
                </div>

                {/* Video Display */}
                <div style={{ 
                    background: '#000', 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center',
                    position: 'relative',
                    aspectRatio: '16 / 9' // Giữ tỷ lệ khung hình 16:9
                }}>
                    <canvas 
                        ref={canvasRef} 
                        style={{ 
                            maxWidth: '100%', 
                            maxHeight: '100%',
                            objectFit: 'contain'
                        }}
                    />
                    {!isReceiving && (
                        <div style={{ 
                            position: 'absolute', 
                            color: '#666', 
                            fontSize: '16px',
                            textAlign: 'center'
                        }}>
                            <div style={{ marginBottom: '10px', fontSize: '60px' }}>📹</div>
                            <div>
                                {isConnected ? 'Đang chờ video stream...' : 'Đang kết nối...'}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
