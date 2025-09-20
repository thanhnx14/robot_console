// app/mobile/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';

// 1. CẬP NHẬT MESSAGE TYPE CHO GIAO THỨC "LAI"
const MessageType = {
    JSON_COMMAND: 0x01,
    IMAGE_FRAME: 0x02,
};

// Cấu hình cho stream
const FPS = 15;
const IMAGE_QUALITY = 0.1;

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

    // State để hiển thị dữ liệu nhận được
    const [latestReceivedFrame, setLatestReceivedFrame] = useState<string | null>(null);
    const [latestAiResult, setLatestAiResult] = useState<any>(null);

    // State và Ref cho kết nối
    const [room] = useState<string>('video_stream_room');
    const [clientId] = useState<string>(`mobile_${Date.now()}`);
    const ws = useRef<WebSocket | null>(null);

    // Refs cho video, canvas và vòng lặp
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);
    const frameIdRef = useRef<number>(0);

    // 2. HELPER FUNCTION ĐỂ GỬI LỆNH JSON
    const sendCommand = useCallback((channel: string, command: string, payload: any = {}) => {
        console.log(ws.current?.readyState)
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

    // Thay thế toàn bộ useEffect hiện tại bằng đoạn code này

    useEffect(() => {
        // URL mới không cần 'role'
        const wsUrl = `ws://thanhhome.duckdns.org:9081/ws/${room}/${clientId}`;

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

        socket.onmessage = (event) => {
            const data = event.data as ArrayBuffer;
            if (data.byteLength < 1) return;

            const view = new DataView(data);
            const msgType = view.getUint8(0);

            if (msgType === MessageType.JSON_COMMAND) {
                const jsonString = new TextDecoder().decode(data.slice(1));
                const message = JSON.parse(jsonString);

                if (message.image && message.ai) {
                    const imageUrl = hexToImageUrl(message.image);

                    setLatestReceivedFrame(prevFrame => {
                        if (prevFrame) URL.revokeObjectURL(prevFrame);
                        return imageUrl;
                    });
                    setLatestAiResult(message.ai);

                    // Sử dụng state isReceiving từ closure để kiểm tra
                    // Điều này tránh đưa isReceiving vào dependency array
                    if (isReceivingRef.current) { // Cần thêm một ref cho isReceiving
                        requestNextPackage();
                    }
                } else {
                    setMessages(prev => [...prev, jsonString]);
                }
            }
        };

        // Hàm dọn dẹp sẽ đóng đúng instance 'socket' mà nó đã tạo
        return () => {
            socket.close();
        };

        // Chỉ tạo lại kết nối khi room hoặc clientId thay đổi
    }, [room, clientId]); // <-- Rút gọn dependency array

    // Cần thêm một ref để theo dõi trạng thái isReceiving
    // mà không cần đưa vào dependency array của useEffect
    const isReceivingRef = useRef(isReceiving);
    useEffect(() => {
        isReceivingRef.current = isReceiving;
    }, [isReceiving]);

    // --- LOGIC GỬI ẢNH (STREAMER) ---
    const sendFrame = useCallback(() => {
        if (!videoRef.current || !canvasRef.current || ws.current?.readyState !== WebSocket.OPEN) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
            if (!blob) return;
            const imageBuffer = await blob.arrayBuffer();

            // Đóng gói header: 1 byte type + 4 byte frame_id
            const header = new ArrayBuffer(5);
            const headerView = new DataView(header);
            headerView.setUint8(0, MessageType.IMAGE_FRAME);
            headerView.setUint32(1, frameIdRef.current, true);
            frameIdRef.current++;

            const messageToSend = new Blob([header, imageBuffer]);
            ws.current?.send(messageToSend);
        }, 'image/jpeg', IMAGE_QUALITY);
    }, []);

    const streamLoop = useCallback((currentTime: number) => {
        animationFrameId.current = requestAnimationFrame(streamLoop);
        // ... logic FPS throttling (giữ nguyên)
        sendFrame();
    }, [sendFrame]);

    // --- CÁC HÀM ĐIỀU KHIỂN ---
    const handleStartStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
            }
            // 5. GỬI LỆNH ĐẾN FSM CỦA SERVER
            sendCommand("streamer", "START_STREAM");
            setIsStreaming(true);
            animationFrameId.current = requestAnimationFrame(streamLoop);
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
        // Bắt đầu chuỗi long-polling
        requestNextPackage();
    };

    const handleStopReceiving = () => {
        sendCommand("viewer", "STOP_RECEIVING");
        setIsReceiving(false);
        setLatestReceivedFrame(null);
        setLatestAiResult(null);
    };


    // --- GIAO DIỆN (RENDER) ---
    return (
        <main style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '800px', margin: 'auto' }}>
            <h1>Video Stream & Control</h1>

            {/* Các element ẩn để xử lý video và canvas */}
            <video ref={videoRef} style={{ display: 'none' }} playsInline></video>
            <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>

            {/* Control Panel */}
            <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
                <h2>Controls</h2>
                <p>Status: <span style={{ color: isConnected ? 'green' : 'red', fontWeight: 'bold' }}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                </span></p>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    {/* Streamer Controls */}
                    <button onClick={handleStartStream} disabled={!isConnected || isStreaming || isReceiving} style={{ padding: '10px', fontSize: '16px' }}>Start Streaming</button>
                    <button onClick={handleStopStream} disabled={!isStreaming} style={{ padding: '10px', fontSize: '16px' }}>Stop Streaming</button>

                    {/* Viewer Controls */}
                    <button onClick={handleStartReceiving} disabled={!isConnected || isStreaming || isReceiving} style={{ padding: '10px', fontSize: '16px' }}>Start Receiving</button>
                    <button onClick={handleStopReceiving} disabled={!isReceiving} style={{ padding: '10px', fontSize: '16px' }}>Stop Receiving</button>
                </div>

                {isStreaming && <p style={{ color: 'blue', margin: 0 }}><strong>Mode:</strong> STREAMING...</p>}
                {isReceiving && <p style={{ color: 'purple', margin: 0 }}><strong>Mode:</strong> RECEIVING...</p>}
            </div>

            {/* Received Stream Display */}
            <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
                <h2>Received Stream</h2>
                <div style={{ minHeight: '240px', background: '#000', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    {latestReceivedFrame ? (
                        <img src={latestReceivedFrame} alt="Received Frame" style={{ maxWidth: '100%', maxHeight: '480px' }} />
                    ) : (
                        <p style={{ color: 'white' }}>Waiting for stream...</p>
                    )}
                </div>
            </div>

            {/* AI Result Display */}
            <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
                <h2>AI Result</h2>
                <pre style={{ background: '#f0f0f0', padding: '10px', borderRadius: '5px', minHeight: '50px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {latestAiResult ? JSON.stringify(latestAiResult, null, 2) : 'No AI data.'}
                </pre>
            </div>
        </main>
    );
}