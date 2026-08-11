# Dam Monitoring System — Backend

Hệ thống backend giám sát đập thủy lợi theo thời gian thực, xây dựng bằng **NestJS**, **TimescaleDB** và **WebSocket**.

---

## Mục lục

- [Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Cài đặt và chạy](#cài-đặt-và-chạy)
  - [1. Clone dự án](#1-clone-dự-án)
  - [2. Cài đặt dependencies](#2-cài-đặt-dependencies)
  - [3. Cấu hình biến môi trường](#3-cấu-hình-biến-môi-trường)
  - [4. Khởi động dịch vụ hạ tầng (Docker)](#4-khởi-động-dịch-vụ-hạ-tầng-docker)
  - [5. Chạy ứng dụng](#5-chạy-ứng-dụng)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [API Endpoints](#api-endpoints)
- [WebSocket](#websocket)
- [Các lệnh hữu ích](#các-lệnh-hữu-ích)

---

## Kiến trúc tổng quan

```
Jetson TX2 (cảm biến vật lý)
        │
        │  HTTP POST /sensor/all
        ▼
┌─────────────────────────┐
│     NestJS Backend      │  :3000
│  - SensorController     │
│  - SensorService        │
│  - VibrationWindow      │
│  - Downsampler          │
│  - SensorGateway (WS)   │
└────────┬────────────────┘
         │                 │
         ▼                 ▼
  TimescaleDB         WebSocket Clients
  (PostgreSQL)        (Dashboard / Frontend)
  :5432

MinIO (lưu ảnh/file)   pgweb (quản lý DB)
:9000 / :9001          :8081
```

---

## Yêu cầu hệ thống

| Công cụ        | Phiên bản tối thiểu | Ghi chú                        |
|----------------|---------------------|-------------------------------|
| Node.js        | >= 18.x             | Khuyến nghị dùng LTS           |
| npm            | >= 9.x              | Đi kèm Node.js                 |
| Docker         | >= 24.x             | Để chạy TimescaleDB & MinIO    |
| Docker Compose | >= 2.x              | `docker compose` (không dấu -) |

> **Kiểm tra nhanh:**
> ```bash
> node -v
> npm -v
> docker -v
> docker compose version
> ```

---

## Cài đặt và chạy

### 1. Clone dự án

```bash
git clone <repository-url>
cd dam_monitoring_system_backend
```

### 2. Cài đặt dependencies

```bash
npm install
```

### 3. Cấu hình biến môi trường

Tạo file `.env` ở thư mục gốc (hoặc chỉnh sửa file `.env` có sẵn):

```env
# Database (TimescaleDB / PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=dam_monitoring

# MinIO (lưu trữ file / ảnh)
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=http://localhost:9000
MINIO_BUCKET=dam-images

# Jetson TX2 (thiết bị cảm biến vật lý)
JETSON_TX2_URL=http://localhost:8080

# Cổng ứng dụng (mặc định 3000)
PORT=3000
```

> ⚠️ **Lưu ý:** Không commit file `.env` chứa thông tin nhạy cảm lên Git.

### 4. Khởi động dịch vụ hạ tầng (Docker)

Lệnh này sẽ khởi động **TimescaleDB**, **MinIO** và **pgweb**:

```bash
docker compose up -d
```

Kiểm tra các container đang chạy:

```bash
docker compose ps
```

Kết quả mong đợi:

```
NAME               STATUS          PORTS
dam_timescaledb    Up              0.0.0.0:5432->5432/tcp
dam_minio          Up              0.0.0.0:9000->9000/tcp, 0.0.0.0:9001->9001/tcp
dam_pgweb          Up              0.0.0.0:8081->8081/tcp
```

**Truy cập các dịch vụ:**

| Dịch vụ        | URL                           | Thông tin đăng nhập              |
|----------------|-------------------------------|----------------------------------|
| TimescaleDB    | `localhost:5432`              | user: `postgres` / pw: `postgres`|
| MinIO Console  | http://localhost:9001         | user: `minioadmin` / pw: `minioadmin` |
| pgweb (DB GUI) | http://localhost:8081         | Tự động kết nối DB               |
| Ngrok Console  | http://localhost:4040         | Quản lý Live Tunnel & Traffic    |


### 5. Chạy ứng dụng

**Môi trường Development (có hot-reload):**

```bash
npm run start:dev
```

**Môi trường Production:**

```bash
npm run build
npm run start:prod
```

Sau khi khởi động thành công, console hiện:

```
Application is running on: http://[::1]:3000
```

Backend đang lắng nghe tại: **http://localhost:3000**

---

## Cấu trúc dự án

```
src/
├── main.ts                        # Điểm khởi động ứng dụng
├── app.module.ts                  # Module gốc (DB, Config, Schedule)
│
├── sensor/                        # Module xử lý cảm biến
│   ├── sensor.module.ts
│   ├── sensor.controller.ts       # REST API endpoints
│   ├── sensor.service.ts          # Business logic chính
│   ├── sensor.dto.ts              # Data Transfer Object
│   ├── sensor-buffer.service.ts   # Buffer dữ liệu in-memory
│   ├── vibration-window.service.ts# Xử lý cửa sổ rung động
│   ├── downsampler.service.ts     # Giảm mẫu dữ liệu
│   └── entities/
│       ├── sensor-reading.entity.ts   # Bảng lưu giá trị cảm biến
│       ├── threshold-config.entity.ts # Cấu hình ngưỡng cảnh báo
│       └── alarm-event.entity.ts      # Sự kiện cảnh báo
│
└── gateway/                       # WebSocket Gateway
    └── sensor.gateway.ts          # Broadcast realtime tới clients
```

---

## API Endpoints

Base URL: `http://localhost:3000`

### Sensor

| Method | Endpoint                      | Mô tả                                      |
|--------|-------------------------------|--------------------------------------------|
| `POST` | `/sensor/all`                 | Nhận dữ liệu từ thiết bị cảm biến         |
| `GET`  | `/sensor/latest`              | Lấy dữ liệu mới nhất + lịch sử in-memory  |
| `GET`  | `/sensor/history/long-term`   | Lịch sử dài hạn từ TimescaleDB            |
| `GET`  | `/sensor/thresholds`          | Lấy cấu hình ngưỡng cảnh báo              |
| `PUT`  | `/sensor/thresholds/:id`      | Cập nhật cấu hình ngưỡng                  |

#### POST `/sensor/all` — Payload mẫu

```json
{
  "freq": 2.5,
  "amp": 0.03,
  "waterLevel": 85.4,
  "moisture": 62.1
}
```

#### GET `/sensor/history/long-term` — Query params

```
?type=waterLevel&limit=100
```

Các giá trị `type` hợp lệ: `waterLevel`, `moisture`, `freq`, `amp`

#### GET `/sensor/thresholds` — Query params

```
?damId=dam_1
```

---

## WebSocket

Backend phát sự kiện realtime qua **Socket.IO**.

**Kết nối:** `ws://localhost:3000`

**Sự kiện lắng nghe (client ← server):**

| Sự kiện         | Mô tả                                         |
|-----------------|-----------------------------------------------|
| `sensorUpdate`  | Dữ liệu cảm biến mới nhất sau mỗi lần ingest  |

**Ví dụ kết nối từ frontend:**

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('sensorUpdate', (data) => {
  console.log('Dữ liệu mới:', data);
});
```

---

## Các lệnh hữu ích

```bash
# Chạy development (hot-reload)
npm run start:dev

# Build production
npm run build

# Chạy production
npm run start:prod

# Chạy unit tests
npm run test

# Chạy test với coverage
npm run test:cov

# Format code
npm run format

# Lint & auto-fix
npm run lint

# Xem log Docker
docker compose logs -f

# Dừng toàn bộ Docker services
docker compose down

# Xóa toàn bộ data Docker (reset DB)
docker compose down -v
```

---

## Xử lý sự cố thường gặp

**Lỗi kết nối DB (`ECONNREFUSED 5432`):**
- Đảm bảo Docker đang chạy: `docker compose ps`
- Chờ ~10 giây sau khi `docker compose up -d` để TimescaleDB khởi động hoàn toàn

**Lỗi `relation does not exist`:**
- Ứng dụng dùng `synchronize: true` nên bảng được tự động tạo khi khởi động
- Kiểm tra lại biến `DB_NAME` trong `.env` có khớp với Docker không

**Cổng 3000 đã bị dùng:**
- Đổi biến `PORT` trong `.env`: `PORT=3001`
