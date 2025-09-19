// app/mobile/page.tsx
"use client";

import { useState, useEffect, useRef } from 'react';

// Giữ nguyên MessageType
const MessageType = {
  IMAGE_WITH_FRAME_ID: 0x01,
  TEXT: 0x02,
  JSON: 0x03,
};

// Cấu hình cho stream
const FPS = 15; // Gửi 15 khung hình mỗi giây
const IMAGE_QUALITY = 0.7; // Chất lượng ảnh JPEG (0.0 - 1.0)

export default function MobilePage() {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  
  // State để hiển thị khung hình nhận được gần nhất
  const [latestReceivedFrame, setLatestReceivedFrame] = useState<string | null>(null);

  // State và Ref cho kết nối
  const [room] = useState<string>('video_stream_room');
  const [role] = useState<string>('streamer');
  const [clientId] = useState<string>(`streamer_${Date.now()}`);
  const ws = useRef<WebSocket | null>(null);

  // Refs cho các element video, canvas và vòng lặp gửi
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const frameIdRef = useRef<number>(0);

  // --- KẾT NỐI WEBSOCKET (Tương tự trước) ---
  useEffect(() => {
    const wsUrl = `ws://thanhhome.duckdns.org:9081/ws/${room}/${role}/${clientId}`;
    ws.current = new WebSocket(wsUrl);
    ws.current.binaryType = 'arraybuffer';

    ws.current.onopen = () => { setIsConnected(true); setMessages(prev => [...prev, "Connected."]); };
    ws.current.onclose = () => { setIsConnected(false); setIsStreaming(false); setMessages(prev => [...prev, "Disconnected."]); };
    ws.current.onerror = (error) => console.error("WebSocket error:", error);

    // --- XỬ LÝ NHẬN DỮ LIỆU ---
    ws.current.onmessage = (event) => {
      const data = event.data as ArrayBuffer;
      if (data.byteLength < 1) return;

      const view = new DataView(data);
      const msgType = view.getUint8(0);

      if (msgType === MessageType.IMAGE_WITH_FRAME_ID) {
        const payload = data.slice(1);
        const imageBytes = payload.slice(4);
        const blob = new Blob([imageBytes], { type: 'image/jpeg' });
        const imageUrl = URL.createObjectURL(blob);
        
        // Hiển thị khung hình mới nhất và hủy URL của khung hình cũ để tiết kiệm bộ nhớ
        setLatestReceivedFrame(prevFrame => {
          if (prevFrame) URL.revokeObjectURL(prevFrame);
          return imageUrl;
        });

      } else if (msgType === MessageType.TEXT) {
        const textMessage = new TextDecoder('utf-8').decode(data.slice(1));
        setMessages(prev => [...prev, textMessage]);
      }
    };

    return () => {
      if (ws.current) ws.current.close();
      if (sendIntervalRef.current) clearInterval(sendIntervalRef.current);
    };
  }, [room, role, clientId]);

  // --- HÀM GỬI MỘT KHUNG HÌNH ---
  const sendFrame = () => {
    if (!videoRef.current || !canvasRef.current || ws.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    
    // 1. Vẽ khung hình từ video vào canvas
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 2. Lấy dữ liệu ảnh từ canvas dưới dạng Blob
    canvas.toBlob(async (blob) => {
      if (!blob) return;

      // 3. Đóng gói và gửi đi (giống như gửi ảnh đơn trước đây)
      const imageBuffer = await blob.arrayBuffer();
      const header = new ArrayBuffer(5);
      const headerView = new DataView(header);
      
      headerView.setUint8(0, MessageType.IMAGE_WITH_FRAME_ID);
      headerView.setUint32(1, frameIdRef.current, true); // little-endian
      frameIdRef.current++;

      const messageToSend = new Blob([header, imageBuffer]);
      ws.current?.send(messageToSend);

    }, 'image/jpeg', IMAGE_QUALITY);
  };
  
  // --- BẮT ĐẦU STREAM ---
  const handleStartStream = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Trình duyệt của bạn không hỗ trợ truy cập camera.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" } // Ưu tiên camera sau
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play(); // Phải play video thì mới có khung hình
      }
      setIsStreaming(true);
      // Bắt đầu vòng lặp gửi khung hình
      sendIntervalRef.current = setInterval(sendFrame, 1000 / FPS);
    } catch (err) {
      console.error("Lỗi truy cập camera:", err);
      alert("Không thể truy cập camera. Vui lòng cấp quyền.");
    }
  };

  // --- DỪNG STREAM ---
  const handleStopStream = () => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop()); // Tắt camera
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  };

  return (
    <main style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '800px', margin: 'auto' }}>
      <h1>Video Stream over WebSocket</h1>

      {/* Các element ẩn để xử lý video và canvas */}
      <video ref={videoRef} style={{ display: 'none' }}></video>
      <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>

      <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h2>Controls</h2>
        <p>Status: <span style={{ color: isConnected ? 'green' : 'red', fontWeight: 'bold' }}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleStartStream} disabled={isStreaming || !isConnected} style={{ padding: '10px', fontSize: '16px' }}>
            Bắt đầu Stream
          </button>
          <button onClick={handleStopStream} disabled={!isStreaming} style={{ padding: '10px', fontSize: '16px' }}>
            Dừng Stream
          </button>
        </div>
        {isStreaming && <p style={{ color: 'blue' }}>Đang stream... ({FPS} FPS)</p>}
      </div>

      <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
          <h2>Received Stream</h2>
          <div style={{ minHeight: '200px', background: '#000', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {latestReceivedFrame ? (
              <img src={latestReceivedFrame} alt="Received Frame" style={{ maxWidth: '100%', maxHeight: '400px' }}/>
            ) : (
              <p style={{ color: 'white' }}>Waiting for stream...</p>
            )}
          </div>
      </div>
      
      <div style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
          <h2>Message Log</h2>
          <div style={{ height: '80px', overflowY: 'auto', background: '#f0f0f0', padding: '5px' }}>
              {messages.map((msg, index) => <p key={index} style={{ margin: '2px 0' }}>{msg}</p>)}
          </div>
      </div>
    </main>
  );
}