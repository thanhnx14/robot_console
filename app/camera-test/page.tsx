// app/camera-test/page.tsx
"use client";

import { useState, useRef, useEffect } from 'react';

export default function CameraTestPage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [actualResolution, setActualResolution] = useState<string>('N/A');
    const [error, setError] = useState<string>('');

    // Hàm để khởi động camera
    const startCamera = async () => {
        // Dọn dẹp stream cũ nếu có
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        setError('');
        setActualResolution('Requesting...');

        // Yêu cầu độ phân giải không vượt quá 640x480
        const constraints = {
            video: {
                 facingMode: "environment",
                 resizeMode: "crop-and-scale",
                width: { max: 640 },
                height: { max: 480 }
            }
        };

        try {
            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            const video = videoRef.current;
            if (video) {
                video.srcObject = newStream;
                video.play();
                setStream(newStream);

                // Lắng nghe sự kiện để đảm bảo video đã có dữ liệu
                video.onloadedmetadata = () => {
                    const track = newStream.getVideoTracks()[0];
                    const settings = track.getSettings();
                    setActualResolution(`${settings.width} x ${settings.height}`);
                };
            }
        } catch (err: any) {
            console.error("Lỗi getUserMedia:", err);
            setError(`Lỗi: ${err.name} - ${err.message}`);
        }
    };

    // Dọn dẹp khi component unmount
    useEffect(() => {
        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [stream]);

    return (
        <main style={{ padding: '20px', fontFamily: 'sans-serif' }}>
            <h1>Camera Performance Test</h1>
            <p>Trang này chỉ dùng để kiểm tra luồng video gốc từ camera.</p>
            
            <button onClick={startCamera} style={{ fontSize: '18px', padding: '10px 20px', marginBottom: '20px' }}>
                Start Camera
            </button>
            
            <div>
                <strong>Độ phân giải yêu cầu (tối đa):</strong> 640 x 480
            </div>
            <div>
                <strong>Độ phân giải thực tế:</strong> <span style={{ color: 'blue', fontWeight: 'bold' }}>{actualResolution}</span>
            </div>
            {error && <div style={{ color: 'red', marginTop: '10px' }}>{error}</div>}

            <h2>Camera Feed:</h2>
            <video 
                ref={videoRef} 
                style={{ 
                    border: '2px solid black', 
                    maxWidth: '100%', 
                    backgroundColor: '#111' 
                }} 
                playsInline 
                autoPlay 
                muted
            ></video>
        </main>
    );
}