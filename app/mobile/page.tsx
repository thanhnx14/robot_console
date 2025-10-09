// app/mobile/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { JoystickManager, JoystickManagerOptions } from 'nipplejs';
import throttle from 'lodash/throttle';

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

// 1. CẬP NHẬT MESSAGE TYPE CHO GIAO THỨC "LAI"
const MessageType = {
    JSON_COMMAND: 0x03,
    IMAGE_FRAME: 0x01,
};

// Cấu hình cho stream
const FPS = 24;
const IMAGE_QUALITY = 0.7 ;
const RENDER_FPS = 30;
const INITIAL_TARGET_FPS = 25;
const FEEDBACK_INTERVAL_MS = 2000;

// --- Helper function để chuyển đổi Hex sang URL ảnh ---
const hexToImageUrl = (hexString: string): string => {
    const bytes = new Uint8Array(hexString.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
};


export default function MobilePage() {
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [messages, setMessages] = useState<string[]>([]);

    // Tách biệt trạng thái cho 2 vai trò
    const [isStreaming, setIsStreaming] = useState<boolean>(false);
    const [isReceiving, setIsReceiving] = useState<boolean>(false);
    const [targetFps, setTargetFps] = useState<number>(INITIAL_TARGET_FPS);

    // State để hiển thị dữ liệu nhận được
    const [latestReceivedFrame, setLatestReceivedFrame] = useState<string | null>(null);
    const [latestAiResult, setLatestAiResult] = useState<any>(null);

    // State và Ref cho kết nối
    const [room] = useState<string>('video_stream_room');
    const [clientId] = useState<string>('web_dashboard_1');
    const ws = useRef<WebSocket | null>(null);

    // Joystick state và refs
    const [joystickData, setJoystickData] = useState({ x: 0, y: 0 });
    const joystickRef = useRef<HTMLDivElement | null>(null);
    const joystickInstance = useRef<JoystickManager | null>(null);

    // Refs cho video, canvas và vòng lặp
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);
    const frameIdRef = useRef<number>(0);
    const lastFrameTimeRef = useRef<number>(0);
    const frameInterval = 1000 / FPS;
    const isProcessingFrame = useRef<boolean>(false);

    const latestPacketRef = useRef<any | null>(null);
    const lastRenderedFrameIdRef = useRef<number>(-1);
    const processingTimesRef = useRef<number[]>([]);
    // === START: THÊM CODE ĐO FPS ===
    const [streamingFps, setStreamingFps] = useState(0);
    const [receivingFps, setReceivingFps] = useState(0);
    const sentFrameCount = useRef(0);
    const receivedFrameCount = useRef(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setStreamingFps(sentFrameCount.current);
            setReceivingFps(receivedFrameCount.current);
            sentFrameCount.current = 0;
            receivedFrameCount.current = 0;
        }, 1000);

        return () => clearInterval(interval);
    }, []);
    // === END: THÊM CODE ĐO FPS ===
    const drawSingleDetection = (ctx: CanvasRenderingContext2D, detection: Detection) => {
        // Sử dụng tọa độ pixel trực tiếp từ server
        const { x1, y1, x2, y2 } = detection.box.pixel;
        const width = x2 - x1;
        const height = y2 - y1;
        
        // 1. Vẽ hộp (bounding box)
        ctx.strokeStyle = 'lime'; // Màu xanh lá
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(x1, y1, width, height);
        ctx.stroke();

        // 2. Vẽ nhãn (class_name và confidence)
        const label = `${detection.class_name} (${Math.round(detection.confidence * 100)}%)`;
        ctx.fillStyle = 'lime';
        ctx.font = '16px Arial';
        ctx.textBaseline = 'bottom'; // Canh chữ ở phía dưới

        // Lấy kích thước của text để vẽ nền
        const textMetrics = ctx.measureText(label);
        const textHeight = 20;
        
        // Vẽ nền cho text
        ctx.fillRect(x1, y1 - textHeight, textMetrics.width + 4, textHeight);

        // Viết chữ lên trên nền
        ctx.fillStyle = 'black';
        ctx.fillText(label, x1 + 2, y1);
    }
    // 2. HELPER FUNCTION ĐỂ GỬI LỆNH JSON
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

    // 3. LOGIC XIN GÓI TIN MỚI (CHO LONG-POLLING)
    const requestNextPackage = useCallback(() => {
        sendCommand("viewer", "REQUEST_LATEST_PACKAGE");
    }, [sendCommand]);

    // Hàm gửi lệnh điều khiển joystick (throttled)
    const sendJoystickCommand = useRef(
        throttle((x: number, y: number) => {
            if (ws.current?.readyState === WebSocket.OPEN) {
                const message = { channel: "controller", command: "MOVE_JOYSTICK", payload: { x, y } };
                const jsonString = JSON.stringify(message);
                const jsonBuffer = new TextEncoder().encode(jsonString);

                const buffer = new Uint8Array(1 + jsonBuffer.length);
                buffer[0] = MessageType.JSON_COMMAND;
                buffer.set(jsonBuffer, 1);

                ws.current.send(buffer);
                // console.log("Sent joystick command:", message);
            }
        }, 100, { trailing: true })
    ).current;

    // Throttle update UI joystick data (tránh re-render quá nhiều)
    const updateJoystickDisplay = useRef(
        throttle((x: number, y: number) => {
            setJoystickData({ x, y });
        }, 200) // Update UI mỗi 200ms thay vì liên tục
    ).current;

    const getWebSocketUrl = (room: string, clientId: string): string => {
        const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = typeof window !== 'undefined' ? window.location.host : '';
        if (!host) return '';
        
        // Nếu dùng ws (không phải wss), thay đổi cổng thành 9081
        let finalHost = host;
        if (protocol === 'ws') {
            const hostname = host.split(':')[0];
            finalHost = `${hostname}:9081`;
        }
        
        return `${protocol}://${finalHost}/api/ws/${room}/${clientId}`;
    };

    useEffect(() => {
        const wsUrl = getWebSocketUrl(room, clientId);
        // Tạo một instance socket cục bộ trong effect
        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';

        // Gán vào ref để các hàm khác có thể truy cập
        ws.current = socket;

        socket.onopen = () => {
            setIsConnected(true);
            setMessages(prev => [...prev, "Connected."]);
        };

        socket.onclose = () => {
            setIsConnected(false);
            setIsStreaming(false);
            setIsReceiving(false);
            setMessages(prev => [...prev, "Disconnected."]);
        };

        socket.onerror = (event) => {
            // Log event ra để có thêm chi tiết nếu có thể
            console.error("WebSocket error:", event);
        };
        
        socket.onmessage = async  (event) => {
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
                    setMessages(prev => [...prev, JSON.stringify(message)]);
                }
            }
        };

        // Hàm dọn dẹp sẽ đóng đúng instance 'socket' mà nó đã tạo
        return () => {
            socket.close();
        };

        // Chỉ tạo lại kết nối khi room hoặc clientId thay đổi
    }, []); // <-- Rút gọn dependency array


    useEffect(() => {
        let renderInterval: NodeJS.Timeout;

        if (isReceiving) {
            renderInterval = setInterval(async () => {
                const latestPacket = latestPacketRef.current;
                if (!latestPacket || latestPacket.frameId <= lastRenderedFrameIdRef.current) {
                    return; // Bỏ qua nếu không có frame mới
                }
                const startTime = performance.now();
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;

                lastRenderedFrameIdRef.current = latestPacket.frameId; // Đánh dấu đã xử lý frame này

                // --- Bắt đầu logic vẽ trực tiếp ---
                try {
                    const bytes = new Uint8Array(latestPacket.image.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
                    const imageBlob = new Blob([bytes], { type: 'image/jpeg' });

                    // Vẽ ảnh lên canvas
                    const imageBitmap = await createImageBitmap(imageBlob);
                    canvas.width = imageBitmap.width;
                    canvas.height = imageBitmap.height;
                    ctx.drawImage(imageBitmap, 0, 0);
                    imageBitmap.close();
                    // Vẽ các detection
                    if (latestPacket.ai?.detections) {
                        latestPacket.ai.detections.forEach((detection: Detection) => {
                            drawSingleDetection(ctx, detection);
                        });
                    }

                } catch (error) {
                    console.error("Lỗi khi render frame:", error);
                }
                // --- Kết thúc logic vẽ ---    
                const endTime = performance.now(); // <<-- Kết thúc đo
                processingTimesRef.current.push(endTime - startTime); 

            }, 1000 / RENDER_FPS);
        }

        return () => {
            if (renderInterval) clearInterval(renderInterval);
            lastRenderedFrameIdRef.current = -1;
            latestPacketRef.current = null;
        };
    }, [isReceiving, drawSingleDetection]);
    // Cần thêm một ref để theo dõi trạng thái isReceiving
    // mà không cần đưa vào dependency array của useEffect
    const isReceivingRef = useRef(isReceiving);
    useEffect(() => {
        isReceivingRef.current = isReceiving;
    }, [isReceiving]);

    useEffect(() => {
        let feedbackInterval: NodeJS.Timeout;
        if (isReceiving) {
            feedbackInterval = setInterval(() => {
                const times = processingTimesRef.current;
                if (times.length < 10) return; // Đợi có đủ mẫu để quyết định

                // 1. Tính toán hiệu năng
                const avgProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;
                processingTimesRef.current = []; // Reset lại để thu thập mẫu mới

                // 2. Logic quyết định FPS mới
                const renderInterval = 1000 / RENDER_FPS;
                let newTargetFps = targetFps;

                if (avgProcessingTime > renderInterval * 0.8) { // Nếu xử lý quá 80% thời gian cho phép -> Quá tải
                    newTargetFps = Math.max(10, targetFps - 5); // Giảm 5 FPS
                } else if (avgProcessingTime < renderInterval * 0.3) { // Nếu xử lý dưới 30% -> Rất rảnh
                    newTargetFps = Math.min(30, targetFps + 3); // Tăng 3 FPS
                }

                // 3. Gửi yêu cầu lên server NẾU có sự thay đổi
                if (newTargetFps !== targetFps) {
                    console.log(`Hiệu năng thay đổi: Thời gian xử lý trung bình ${avgProcessingTime.toFixed(2)}ms. Đổi FPS từ ${targetFps} -> ${newTargetFps}`);
                    setTargetFps(newTargetFps);
                    sendCommand('viewer', 'ADJUST_FPS', { fps: newTargetFps });
                }
            }, FEEDBACK_INTERVAL_MS);
        }

        return () => { if (feedbackInterval) clearInterval(feedbackInterval); };
    }, [isReceiving, targetFps, sendCommand]);
    // --- LOGIC GỬI ẢNH (STREAMER) ---
    const sendFrame = useCallback(async () => {
        if (!videoRef.current || !canvasRef.current || ws.current?.readyState !== WebSocket.OPEN){
            isProcessingFrame.current = false;
            return;
        }

        
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        const imageBitmap = await createImageBitmap(video);
        if (!context) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
        imageBitmap.close();


        canvas.toBlob(async (blob) => {
            if (!blob || ws.current?.readyState !== WebSocket.OPEN) {
                isProcessingFrame.current = false;
                return;
            }
            const imageBuffer = await blob.arrayBuffer();

            // Đóng gói header: 1 byte type + 4 byte frame_id
            const header = new ArrayBuffer(5);
            const headerView = new DataView(header);
            headerView.setUint8(0, MessageType.IMAGE_FRAME);
            headerView.setUint32(1, frameIdRef.current, true);
            frameIdRef.current++;

            const messageToSend = new Blob([header, imageBuffer]);
            ws.current?.send(messageToSend);
            // === START: CẬP NHẬT BỘ ĐẾM FPS KHI GỬI ===
            sentFrameCount.current++;
            
            isProcessingFrame.current = false;
            // console.log(frameIdRef.current +":"+ getCurentTime())
            // === END: CẬP NHẬT BỘ ĐẾM FPS KHI GỬI ===
        }, 'image/jpeg', IMAGE_QUALITY);
    }, []);

    const getCurentTime = () => {
        const now = new Date();

            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

            return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    }

    const streamLoop = useCallback((currentTime: number) => {
        animationFrameId.current = requestAnimationFrame(streamLoop);

        if (isProcessingFrame.current) {
            return;
        }
        // Tính toán thời gian đã trôi qua kể từ frame cuối
        const deltaTime = currentTime - lastFrameTimeRef.current;

        // Nếu chưa đủ thời gian, bỏ qua và chờ frame kế tiếp
        if (deltaTime < frameInterval) {
            return;
        }

        // Đã đủ thời gian, cập nhật lại thời gian của frame cuối
        // Phép chia lấy dư giúp tránh lỗi cộng dồn thời gian (drift)
        lastFrameTimeRef.current = currentTime - (deltaTime % frameInterval);
        isProcessingFrame.current = true;

        sendFrame();
    }, [sendFrame, frameInterval]);

    // --- CÁC HÀM ĐIỀU KHIỂN ---
    const handleStartStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { 
                frameRate:15,
                width: { max: 640 },
                height: { max: 640 }
                
            } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
            
                videoRef.current.oncanplay = () => {
                    // Đặt mốc thời gian ban đầu ở đây để tính toán deltaTime cho chính xác
                    lastFrameTimeRef.current = performance.now(); 

                    // Gửi lệnh và bắt đầu vòng lặp stream TỪ BÊN TRONG NÀY
                    sendCommand("streamer", "START_STREAM");
                    setIsStreaming(true);
                    animationFrameId.current = requestAnimationFrame(streamLoop);
                };
            }
        } catch (err) {
            console.error("Lỗi truy cập camera:", err);
        }
    };

    const handleStopStream = () => {
        sendCommand("streamer", "STOP_STREAM");
        cancelAnimationFrame(animationFrameId.current);
        if (videoRef.current && videoRef.current.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        setIsStreaming(false);
    };

    const handleStartReceiving = () => {
        sendCommand("viewer", "START_RECEIVING");
        setIsReceiving(true);
        setTargetFps(INITIAL_TARGET_FPS);
    };

    const handleStopReceiving = () => {
        sendCommand("viewer", "STOP_RECEIVING");
        setIsReceiving(false);
        setLatestReceivedFrame(null);
        setLatestAiResult(null);
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    const handleEsp32StartStream = () => {
        sendCommand("controller", "START_DEVICE_STREAM");
    };

    const handleEsp32StopStream = () => {
        sendCommand("controller", "STOP_DEVICE_STREAM");
    };

    const handleWakeUpRobot = async () => {
        try {
            // Xây dựng URL đến server WebSocket backend
            const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
            const host = typeof window !== 'undefined' ? window.location.host : '';
            const apiUrl = `${protocol}://${host}/api/control/ble-wake`;
            
            const response = await fetch(apiUrl);
            const data = await response.json();
            console.log("Wake up robot response:", data);
            setMessages(prev => [...prev, `Wake Up Robot: ${JSON.stringify(data)}`]);
        } catch (error) {
            console.error("Lỗi khi wake up robot:", error);
            setMessages(prev => [...prev, `Lỗi Wake Up Robot: ${error}`]);
        }
    };

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
                    size: 120,
                    restJoystick: true,
                };

                const joystick: JoystickManager = nipplejs.create(options);
                joystickInstance.current = joystick;

                // Xử lý sự kiện move
                joystick.on('move', (evt, data) => {
                    // Chuyển đổi từ vector (-1 to 1) sang range (-100 to 100)
                    const x = Math.round(data.vector.x * 100);
                    const y = Math.round(data.vector.y * 100);
                    
                    // Gửi lệnh điều khiển (100ms throttle)
                    sendJoystickCommand(x, y);
                    
                    // Cập nhật UI (200ms throttle - tránh re-render quá nhiều)
                    updateJoystickDisplay(x, y);
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
    }, [sendJoystickCommand, updateJoystickDisplay]);


    // --- GIAO DIỆN (RENDER) ---
    return (
        <main style={{ 
            padding: '0', 
            fontFamily: 'sans-serif', 
            minHeight: '100vh',
            background: '#1a1a1a',
            display: 'flex',
            flexDirection: 'column'
        }}>
            <video ref={videoRef} style={{ display: 'none' }} playsInline></video>
            {/* Header - Status Bar */}
            <div style={{ 
                background: '#2d2d2d', 
                padding: '10px 15px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '2px solid #3B82F6'
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>🤖 Robot Control</h1>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ 
                        width: '10px', 
                        height: '10px', 
                        borderRadius: '50%', 
                        background: isConnected ? '#10b981' : '#ef4444',
                        boxShadow: isConnected ? '0 0 10px #10b981' : 'none'
                    }}></div>
                    <span style={{ fontSize: '12px', color: '#999' }}>FPS: {receivingFps}</span>
                </div>
            </div>

            {/* Video Stream Display */}
            <div style={{ 
                flex: '0 0 auto',
                background: '#000', 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                minHeight: '200px',
                maxHeight: '40vh'
            }}>
                <canvas 
                    ref={canvasRef} 
                    style={{ 
                        width: '100%', 
                        height: 'auto',
                        maxHeight: '40vh',
                        objectFit: 'contain'
                    }}
                />
                {!isReceiving && (
                    <div style={{ 
                        position: 'absolute', 
                        color: '#666', 
                        fontSize: '14px',
                        textAlign: 'center'
                    }}>
                        📹 Waiting for video stream...
                    </div>
                )}
            </div>

            {/* Joystick Control Section */}
            <div style={{ 
                flex: '1 1 auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '20px',
                background: 'linear-gradient(180deg, #1a1a1a 0%, #2d2d2d 100%)'
            }}>
                <div style={{ 
                    marginBottom: '15px',
                    fontSize: '14px',
                    color: '#999',
                    textAlign: 'center'
                }}>
                    🕹️ Điều khiển Robot
                </div>
                
                {/* Joystick Container */}
                <div
                    ref={joystickRef}
                    style={{ 
                        width: '180px', 
                        height: '180px', 
                        background: 'radial-gradient(circle, #3d3d3d 0%, #2d2d2d 100%)',
                        borderRadius: '50%',
                        position: 'relative',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.5), inset 0 2px 10px rgba(255,255,255,0.1)',
                        border: '3px solid #3B82F6'
                    }}
                ></div>

                {/* Joystick Data Display */}
                <div style={{ 
                    marginTop: '20px',
                    fontSize: '16px', 
                    fontWeight: 'bold',
                    padding: '10px 20px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    borderRadius: '8px',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    color: '#3B82F6',
                    fontFamily: 'monospace'
                }}>
                    X: {joystickData.x.toString().padStart(4, ' ')} | Y: {joystickData.y.toString().padStart(4, ' ')}
                </div>
            </div>

            {/* Bottom Control Buttons */}
            <div style={{ 
                flex: '0 0 auto',
                background: '#2d2d2d', 
                padding: '15px',
                borderTop: '1px solid #444'
            }}>
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '10px',
                    marginBottom: '10px'
                }}>
                    <button 
                        onClick={handleStartReceiving} 
                        disabled={!isConnected || isStreaming || isReceiving}
                        style={{
                            padding: '12px',
                            fontSize: '14px',
                            background: isReceiving ? '#666' : '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: isConnected && !isStreaming && !isReceiving ? 'pointer' : 'not-allowed',
                            fontWeight: '600',
                            opacity: !isConnected || isStreaming || isReceiving ? 0.5 : 1
                        }}
                    >
                        ▶️ Start View
                    </button>
                    <button 
                        onClick={handleStopReceiving} 
                        disabled={!isReceiving}
                        style={{
                            padding: '12px',
                            fontSize: '14px',
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: isReceiving ? 'pointer' : 'not-allowed',
                            fontWeight: '600',
                            opacity: !isReceiving ? 0.5 : 1
                        }}
                    >
                        ⏹️ Stop View
                    </button>
                </div>

                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '10px'
                }}>
                    <button 
                        onClick={handleEsp32StartStream} 
                        disabled={!isConnected}
                        style={{
                            padding: '12px',
                            fontSize: '14px',
                            background: '#3B82F6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: isConnected ? 'pointer' : 'not-allowed',
                            fontWeight: '600',
                            opacity: !isConnected ? 0.5 : 1
                        }}
                    >
                        📹 ESP32 Start
                    </button>
                    <button 
                        onClick={handleEsp32StopStream} 
                        disabled={!isConnected}
                        style={{
                            padding: '12px',
                            fontSize: '14px',
                            background: '#f59e0b',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: isConnected ? 'pointer' : 'not-allowed',
                            fontWeight: '600',
                            opacity: !isConnected ? 0.5 : 1
                        }}
                    >
                        🔴 ESP32 Stop
                    </button>
                </div>

                <button 
                    onClick={handleWakeUpRobot} 
                    disabled={!isConnected}
                    style={{
                        width: '100%',
                        marginTop: '10px',
                        padding: '12px',
                        fontSize: '14px',
                        background: '#8b5cf6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: isConnected ? 'pointer' : 'not-allowed',
                        fontWeight: '600',
                        opacity: !isConnected ? 0.5 : 1
                    }}
                >
                    ⚡ Wake Up Robot
                </button>
            </div>
        </main>
    );
}