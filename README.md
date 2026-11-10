# 🚀 Quadrate Game Real-Time Multiplayer Server (Render.com Deployment Guide)

ไฟล์ในโฟลเดอร์นี้ (`server/`) เป็นระบบเซิร์ฟเวอร์ WebSocket สำหรับการเล่นเกม Quadrate Game ออนไลน์ข้ามเครื่องแบบ Real-Time ออกแบบมาเพื่อนำไป Deploy บน **Render.com** (ฟรี) โดยเฉพาะ

---

## 📁 โครงสร้างไฟล์ในเซิร์ฟเวอร์
```
server/
├── package.json   # กำหนด Dependency (ws) และคำสั่ง Start สำหรับ Render
├── server.js      # WebSocket & HTTP Server สำหรับจัดการห้อง รหัสผ่าน และคะแนนสด
└── README.md      # คู่มือการติดตั้งและการนำไปใช้
```

---

## 🛠️ วิธีนำขึ้น Render.com (ใช้เวลาเพียง 2 นาที)

### วิธีที่ 1: สร้าง GitHub Repo แยกสำหรับเซิร์ฟเวอร์ (แนะนำที่สุด สะดวกและเร็วมาก)
1. สมัครหรือเข้าสู่ระบบที่ [Render.com](https://render.com)
2. นำโฟลเดอร์ `server` นี้ขึ้น GitHub repository ของคุณเอง (เช่น ตั้งชื่อว่า `tetris-multiplayer-server`)
3. ในหน้า Dashboard ของ Render กดปุ่ม **"New +"** แล้วเลือก **"Web Service"**
4. เชื่อมต่อกับ GitHub Repo ของเซิร์ฟเวอร์ที่คุณเพิ่งอัปโหลด
5. ตั้งค่าการ Deploy ดังนี้:
   * **Name:** `tetris-wood-server` (หรือชื่อใดก็ได้ตามต้องการ)
   * **Region:** Singapore (หรือที่ใกล้ที่สุดเพื่อให้ Ping ต่ำ)
   * **Branch:** `main`
   * **Runtime:** `Node`
   * **Build Command:** `npm install`
   * **Start Command:** `node server.js`
   * **Instance Type:** `Free`
6. กดปุ่ม **"Create Web Service"**
7. รอประมาณ 1-2 นาที Render จะสร้าง URL ให้คุณ เช่น:
   ```
   https://tetris-wood-server.onrender.com
   ```
8. นำ URL ที่ได้จาก Render มาใส่ในไฟล์ `game.js` ตรงตัวแปรการตั้งค่าหลังบ้าน (บรรทัด ~5055):
   ```javascript
   const DEFAULT_RENDER_WS_URL = 'wss://your-render-name.onrender.com';
   ```
   *(ผู้เล่นจะไม่เห็นช่องพิมพ์หรือข้อมูลทางเทคนิคใดๆ บนหน้าจอเกม ระบบจะทำการเชื่อมต่อให้อัตโนมัติทันทีที่เข้าเกม)*

---

## ⚡ ทดสอบการทำงานในเครื่องตัวเอง (Local Test)
หากต้องการรันเซิร์ฟเวอร์บนเครื่องตัวเองเพื่อทดสอบ:
```bash
cd server
npm install
node server.js
```
เซิร์ฟเวอร์จะเปิดที่พอร์ต `10000` (`ws://localhost:10000`)
