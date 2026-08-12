# Dam Monitoring System — Backend Service 🌊⚡

Hệ thống backend chuyên dụng cho việc giám sát đập thủy điện và trạm quan trắc theo thời gian thực, tích hợp cảm biến IoT ESP32, xử lý dữ liệu rung động FFT, lưu trữ chuỗi thời gian trên **TimescaleDB / PostgreSQL**, truyền tải dữ liệu qua **MQTT Mosquitto & WebSocket Socket.IO**, và cung cấp RESTful APIs quản lý Đập, Trạm, Cụm cảm biến.

---

## 📋 Mục lục

1. [Kiến trúc hệ thống tổng quan](#1-kiến-trúc-hệ-thống-tổng-quan)
2. [Công nghệ sử dụng](#2-công-nghệ-sử-dụng)
3. [Cơ sở dữ liệu & Thể hiện Thực thể (Entities)](#3-cơ-sở-dữ-liệu--thể-hiện-thực-thể-entities)
4. [Các quy tắc Validate & Auto-Generation ID](#4-các-quy-tắc-validate--auto-generation-id)
5. [Cấu hình và Khởi động](#5-cấu-hình-và-khởi-động)
6. [API Endpoints danh mục](#6-api-endpoints-danh-mục)
7. [Luồng dữ liệu IoT ESP32 / MQTT / WebSocket](#7-luồng-dữ-liệu-iot-esp32--mqtt--websocket)

---

## 1. Kiến trúc hệ thống tổng quan

```
┌─────────────────────────────────────────────────────────────────┐
│              ESP32 / Physical Sensors (IoT Edge)                │
│  - MPU6050 (Vibration + FFT)                                   │
│  - Ultrasonic (Water Level)                                     │
│  - Soil Moisture Sensor                                         │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                   MQTT / HTTP   │  dam_monitoring/sensor_data
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Mosquitto MQTT Broker                       │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     NestJS Backend Service                      │
│  - SensorModule (MQTT Subscriber / REST Receiver)               │
│  - DamModule (Dams & Stations CRUD, Vietnam GPS Coords)         │
│  - SensorClusterModule (Clusters & Devices CRUD, Memory Cache)  │
│  - SensorGateway (WebSocket Real-time Broadcaster)              │
└───────────────┬─────────────────────────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
  TimescaleDB (PostgreSQL)               Next.js Frontend Client
  Lưu trữ dữ liệu chuỗi thời gian         Giao diện Giám sát Realtime & GIS
```

---

## 2. Công nghệ sử dụng

- **Framework**: NestJS (Node.js TypeScript framework)
- **Database**: TimescaleDB / PostgreSQL với TypeORM
- **Broker IoT**: Eclipse Mosquitto (MQTT Protocol)
- **Real-time**: Socket.IO Gateway (`@nestjs/platform-socket.io`)
- **Object Storage**: MinIO (Lưu ảnh camera / file nhật ký)
- **Xử lý số liệu**: Fast Fourier Transform (FFT) & Dynamic Downsampling

---

## 3. Cơ sở dữ liệu & Thể hiện Thực thể (Entities)

### 3.1 Đập Thủy Điện (`Dam`)
- `id` (string, Primary Key): Slug mã đập tự động (vd: `dam_dap_thuy_dien_hoa_binh`).
- `name` (string): Tên đập thủy điện.
- `location` (string): Địa danh / Vị trí hành chính.
- `latitude` (float): Tọa độ vĩ độ (°N).
- `longitude` (float): Tọa độ kinh độ (°E).
- `waterLevel` (float): Mực nước hiện tại (m).
- `flow` (float): Lưu lượng xả ($m^3/s$).
- `fillPct` (float): Tỷ lệ dung tích chứa (%).
- `status` (string): Trang thái (`safe` | `warning` | `danger`).

### 3.2 Trạm Quan Trắc (`Station`)
- `id` (number / string): Mã trạm.
- `name` (string): Tên trạm quan trắc (vd: `Trạm Tân Ấp 1`).
- `location` (string): Vị trí trạm.
- `latitude` (float): Tọa độ vĩ độ (°N).
- `longitude` (float): Tọa độ kinh độ (°E).
- `river` (string): Tên dòng sông.
- `km` (string): Lý trình Km (vd: `K25+500`).
- `bd1`, `bd2`, `bd3` (float): Ngưỡng báo động 1, 2, 3 (m).
- `damId` (string, Foreign Key): Mã Đập trực thuộc.

### 3.3 Cụm Cảm Biến (`SensorCluster`)
- `id` (string, Primary Key): Slug mã cụm tự động (vd: `cluster_tram_tan_ap_1_k25_500`).
- `name` (string): Tên cụm cảm biến.
- `description` (string): Mô tả cụm.
- `espMacAddress` (string): Địa chỉ MAC cứng của ESP32.
- `firmwareVersion` (string): Phiên bản Firmware.
- `installLocation` (string): Vị trí lắp đặt.
- `stationId` (number, Foreign Key): Mã Trạm trực thuộc.

---

## 4. Các quy tắc Validate & Auto-Generation ID

1. **Auto Slug Generation**:
   - Khi tạo mới Đập hoặc Cụm cảm biến mà không truyền ID, backend tự động áp dụng hàm `toSlug()` để tạo mã readable tiếng Việt không dấu.
   - Định dạng Cụm: `cluster_[station_slug]_[location_slug]`.
   - Định dạng Đập: `dam_[name_slug]`.

2. **Validate Trùng Lặp (409 Conflict)**:
   - Nếu mã ID đập/cụm đã tồn tại hoặc tên trạm bị trùng trên cùng một đập, backend ném exception `ConflictException (HTTP 409)` ngăn không cho ghi đè dữ liệu.

3. **Memory Isolation**:
   - Bộ nhớ đệm giữ snapshot dữ liệu độc lập cho từng Cụm (`latestByCluster`) và từng Trạm (`latestByStation`), tránh tình trạng ghi đè chéo dữ liệu giữa các thiết bị.

---

## 5. Cấu hình và Khởi động

### 5.1 Cài đặt môi trường
Tạo file `.env` tại thư mục gốc:

```env
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=dam_monitoring

MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=http://localhost:9000
MINIO_BUCKET=dam-images
```

### 5.2 Khởi chạy với Docker Compose

```bash
# Khởi chạy Backend, TimescaleDB, MinIO, Mosquitto & Pgweb
docker compose up -d --build
```

### 5.3 Khởi chạy thủ công (Development Mode)

```bash
npm install
npm run start:dev
```

---

## 6. API Endpoints danh mục

### 🔴 Đập Thủy Điện (`/dam`)
- `GET /dam`: Lấy danh sách tất cả đập thủy điện.
- `GET /dam/:id`: Lấy chi tiết đập theo ID.
- `POST /dam`: Tạo đập mới (Tự động sinh slug ID, validate trùng 409).
- `PUT /dam/:id`: Cập nhật thông tin đập / tọa độ GPS.
- `DELETE /dam/:id`: Xóa đập thủy điện và các trạm phụ thuộc.

### 📡 Trạm Quan Trắc (`/dam/station`)
- `GET /dam/station`: Lấy danh sách tất cả trạm.
- `POST /dam/station`: Tạo trạm quan trắc mới dưới đập chỉ định.
- `PUT /dam/station/:id`: Cập nhật thông tin trạm / tọa độ / ngưỡng BĐ.
- `DELETE /dam/station/:id`: Xóa trạm quan trắc.

### 🛡️ Cụm Cảm Biến (`/sensor-clusters`)
- `GET /sensor-clusters`: Lấy danh sách cụm cảm biến (hỗ trợ lọc theo `damId` / `stationId`).
- `POST /sensor-clusters`: Tạo mới cụm cảm biến.
- `PUT /sensor-clusters/:id`: Cập nhật thông tin cụm cảm biến.
- `DELETE /sensor-clusters/:id`: Xóa cụm cảm biến.
- `POST /sensor-clusters/:clusterId/devices`: Thêm cảm biến vào cụm.
- `PUT /sensor-clusters/:clusterId/devices/:deviceId`: Cập nhật cảm biến.
- `DELETE /sensor-clusters/:clusterId/devices/:deviceId`: Xóa cảm biến khỏi cụm.

---

## 7. Luồng dữ liệu IoT ESP32 / MQTT / WebSocket

1. **ESP32 Firmware**:
   - Thu thập dữ liệu rung (MPU6050 + FFT), mực nước (Siêu âm) và độ ẩm đất.
   - Đóng gói JSON kèm `clusterId`, `damId`, `stationId`.
   - Phát MQTT payload tới chủ đề `dam_monitoring/sensor_data`.

2. **NestJS Backend**:
   - Subscribe topic MQTT và giải mã JSON payload.
   - Cập nhật snapshot dữ liệu vào bộ nhớ đệm `latestByCluster` và `latestByStation`.
   - Lưu trữ chuỗi thời gian vào TimescaleDB.
   - Phát sự kiện WebSocket `sensor_update` tới các client Next.js đang mở Dashboard.
