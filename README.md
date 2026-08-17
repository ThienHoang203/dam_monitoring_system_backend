# Dam Monitoring System — Backend Service 🌊⚡

Hệ thống Backend chuyên dụng phục vụ việc **giám sát an toàn đập thủy điện và trạm quan trắc theo thời gian thực**. Hệ thống tích hợp toàn diện từ thiết bị biên IoT (ESP32, cảm biến MPU6050, siêu âm, độ ẩm, Jetson TX2 AI), truyền tải dữ liệu đa giao thức qua **MQTT (Mosquitto)** và **WebSocket (Socket.IO)**, lưu trữ chuỗi thời gian trên **TimescaleDB / PostgreSQL**, lưu trữ ảnh bằng chứng camera AI trên **MinIO**, và cung cấp hệ thống RESTful API chuẩn mực kèm phân quyền chặt chẽ theo vai trò (RBAC).

---

## 📋 Mục lục

1. [Kiến trúc hệ thống tổng quan](#1-kiến-trúc-hệ-thống-tổng-quan)
2. [Ngăn xếp công nghệ (Tech Stack)](#2-ngăn-xếp-công-nghệ-tech-stack)
3. [Mô hình dữ liệu & Thực thể (Database Entities)](#3-mô-hình-dữ-liệu--thực-thể-database-entities)
4. [Phân quyền người dùng & Bảo mật (RBAC & Auth)](#4-phân-quyền-người-dùng--bảo-mật-rbac--auth)
5. [Quy chuẩn định danh thiết bị (Naming Convention A.3.2)](#5-quy-chuẩn-định-danh-thiết-bị-naming-convention-a32)
6. [Hạ tầng IoT, MQTT & WebSocket Real-time](#6-hạ-tầng-iot-mqtt--websocket-real-time)
7. [Danh mục REST API Endpoints](#7-danh-mục-rest-api-endpoints)
8. [Cấu hình biến môi trường (.env)](#8-cấu-hình-biến-môi-trường-env)
9. [Hướng dẫn cài đặt & Khởi chạy](#9-hướng-dẫn-cài-đặt--khởi-chạy)
10. [Kiểm thử tự động (Testing)](#10-kiểm-thử-tự-động-testing)

---

## 1. Kiến trúc hệ thống tổng quan

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           IoT Edge / Thiết bị Hiện Trường                         │
│  - Cảm biến: Rung động MPU6050 (FFT), Mực nước Siêu âm (WTL), Độ ẩm đất (MST)     │
│  - Sensor Node ESP32: Thu thập số liệu, truyền về Gateway                         │
│  - Gateway Jetson TX2: Xử lý AI thị giác (YOLO phát hiện vết nứt), đồng bộ Config │
│  - Camera CSI / RTSP: Chụp ảnh bằng chứng khi phát hiện rung động / vượt ngưỡng   │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │ MQTT Protocol (telemetry, heartbeat, alerts)
                                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                            Mosquitto MQTT Broker (:1883)                          │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        NestJS Backend Core Service (:3001)                        │
│ ┌──────────────────────┬──────────────────────┬─────────────────────────────────┐ │
│ │  AuthModule (JWT)    │  Dam & Station Module│  Gateway & Node Module          │ │
│ │  - RBAC Guard        │  - GIS Coordinates   │  - Config Sync & Heartbeat Cron │ │
│ │  - User Approvals    │  - Threshold Engine  │  - Naming Convention Validator  │ │
│ ├──────────────────────┼──────────────────────┼─────────────────────────────────┤ │
│ │  SensorModule (IoT)  │  Camera & Evidence   │  AuditLogModule                 │ │
│ │  - Downsampling      │  - MinIO S3 Storage  │  - Operation Audit Trail        │ │
│ │  - WebSocket Gateway │  - YOLO AI Crack Res │  - Excel Report Exporter        │ │
│ └──────────────────────┴──────────────────────┴─────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                │               │                                   │
                ▼               ▼                                   ▼
        TimescaleDB / PG      MinIO S3 Bucket                 Socket.IO / REST
     Chuỗi thời gian & CRUD   Ảnh chụp bằng chứng AI          Next.js Frontend Client
```

---

## 2. Ngăn xếp công nghệ (Tech Stack)

- **Backend Framework**: [NestJS 11](https://nestjs.com/) (Node.js TypeScript, kiến trúc Modular Enterprise).
- **Cơ sở dữ liệu**: [PostgreSQL 16](https://www.postgresql.org/) kết hợp [TimescaleDB](https://www.timescale.com/) (Tối ưu hóa Hypertable cho chuỗi thời gian đo đạc cảm biến).
- **ORM**: [TypeORM](https://typeorm.io/) với quan hệ lồng nhau Eager/Lazy linh hoạt.
- **Message Broker IoT**: [Eclipse Mosquitto](https://mosquitto.org/) (MQTT v3.1.1/v5.0).
- **Giao tiếp Real-time**: [Socket.IO](https://socket.io/) (`@nestjs/platform-socket.io`, `@nestjs/websockets`).
- **Lưu trữ Đối tượng (Object Storage)**: [MinIO S3](https://min.io/) (Lưu trữ ảnh camera và bằng chứng nứt vỡ).
- **Xác thực & Bảo mật**: JWT (`passport-jwt`), `bcrypt`, `GatewayApiKeyGuard` cho thiết bị biên.
- **Tác vụ định kỳ (Cron Jobs)**: `@nestjs/schedule` (Giám sát trạng thái Online/Offline của Gateway/Node theo chu kỳ).
- **Thông báo khẩn cấp**: [Nodemailer](https://nodemailer.com/) (SMTP gửi email tự động tới cán bộ vận hành).
- **Kiểm thử**: [Jest](https://jestjs.io/), Supertest (Hệ thống kiểm thử Unit, Integration và E2E toàn diện).

---

## 3. Mô hình dữ liệu & Thực thể (Database Entities)

### 3.1 `Dam` — Đập Thủy Điện
- `damId` (string, PK): Mã định danh đập (vd: `dam_1`, `dam_2` hoặc slug).
- `name` (string): Tên công trình đập thủy điện.
- `location` (string): Vị trí địa lý / Tỉnh thành.
- `lat`, `lng` (float): Tọa độ GPS phục vụ bản đồ GIS.
- `waterLevel`, `maxLevel`, `deadLevel`, `flowRate`, `capacity` (float): Các thông số thủy văn và dung tích.
- `status` (string): Trạng thái tổng thể (`safe` | `warning` | `danger`).
- `stations` (OneToMany): Danh sách các trạm quan trắc trực thuộc.

### 3.2 `Station` — Trạm Quan Trắc
- `id` (PK), `stationId` (string, Unique): Mã định danh trạm (vd: `STA-001-01`).
- `stationCode` (string): Mã ngắn trạm (vd: `ST01`).
- `name` (string): Tên trạm quan trắc (vd: `Trạm Thân Đập Chính`).
- `location`, `river`, `km` (string): Vị trí lý trình, sông suối.
- `lat`, `lng` (float): Tọa độ GPS của trạm.
- `status` (string): Trạng thái an toàn của trạm.
- `damId` (string, FK): Mã đập trực thuộc.
- `gateways` (OneToMany): Danh sách các Gateway Jetson TX2 thuộc trạm.

### 3.3 `Gateway` — Thiết bị Biên (Jetson TX2)
- `id` (PK), `gatewayId` (string, Unique): Mã gateway theo chuẩn A.3.2 (vd: `GTW-ST01-TX2A`).
- `name`, `ipAddress`, `macAddress` (string): Thông số kết nối mạng.
- `status` (string): Trạng thái phần cứng (`online` | `offline` | `error`).
- `lastSeen` (Date): Thời điểm gửi Heartbeat / Telemetry gần nhất.
- `stationRefId` (FK): Trạm quan trắc gắn kết.
- `nodes` (OneToMany): Các Node ESP32 kết nối qua Gateway.
- `cameras` (OneToMany): Camera CSI / RTSP kết nối với Gateway.

### 3.4 `SensorNode` — Sensor Node (ESP32)
- `id` (PK), `nodeId` (string, Unique): Mã node (vd: `NOD-ST01-TX2A-N01`).
- `name`, `status`, `batteryLevel`, `lastSeen`: Thông tin hoạt động.
- `gatewayRefId` (FK): Gateway phụ trách.
- `mappedCamera` (OneToOne): Camera AI được ghép đôi với Node để tự động kích hoạt khi có rung động.
- `sensors` (OneToMany): Các cảm biến đo đạc vật lý thuộc Node.

### 3.5 `Sensor` — Cảm biến Đo đạc
- `id` (PK), `sensorId` (string, Unique): Mã cảm biến (vd: `SEN-ST01-TX2A-N01-VIB`).
- `type` (string): Loại cảm biến (`vibration` | `water_level` | `moisture`).
- `unit` (string): Đơn vị đo (`mm/s`, `m`, `%`).
- `thresholdMin`, `thresholdMax`, `thresholdCritical`: Ngưỡng an toàn kỹ thuật.

### 3.6 `AlarmEvent` — Sự kiện Cảnh báo & Nhận diện AI
- `id` (UUID), `eventId` (string): Mã sự cố (vd: `EVT-001`).
- `damId`, `stationId`, `sensorId`, `sensorType`: Vị trí và loại cảm biến phát sinh cảnh báo.
- `severity` (string): Mức độ (`WARNING` | `ALERT` | `CRITICAL`).
- `measuredVal`, `thresholdVal` (float): Giá trị đo thực tế và ngưỡng vi phạm.
- `triggeredAt`, `resolvedAt` (Date): Thời gian xảy ra và thời gian khắc phục.
- `crackDetected` (boolean), `crackConfidence` (float): Kết quả nhận diện thị giác AI từ YOLO.
- `imageUrl` (string): Đường dẫn ảnh bằng chứng trên MinIO.
- `notes` (string): Ghi chú của cán bộ trực ca.

### 3.7 `SensorReading` — Chuỗi Dữ Liệu Thời Gian (TimescaleDB)
- `time` (timestamp): Thời điểm đo.
- `sensorId`, `stationId`, `damId`, `sensorType`: Định danh cảm biến.
- `value` (float): Giá trị đo thực tế.

### 3.8 `SystemLog` — Nhật Ký Thao Tác Hệ Thống (Audit Logs)
- `id` (UUID), `timestamp` (Date): Thời điểm ghi nhận.
- `username`, `userRole`, `ipAddress`: Người thực hiện.
- `category` (enum): Phân loại (`AUTH` | `DAM` | `STATION` | `GATEWAY` | `THRESHOLD`).
- `action`, `description`: Chi tiết hành động.
- `metadata` (JSON): Dữ liệu chi tiết đính kèm.

### 3.9 `User` — Tài khoản Người dùng
- `id` (UUID), `username` (Unique), `passwordHash`: Thông tin xác thực.
- `fullName`, `email`, `phoneNumber`: Thông tin liên hệ.
- `role` (enum): Vai trò (`ADMIN` | `OPERATOR` | `VIEWER`).
- `status` (enum): Trạng thái duyệt (`APPROVED` | `PENDING_APPROVAL` | `REJECTED`).
- `assignedDamId` (string, Nullable): Mã đập phân công phụ trách cho cán bộ `OPERATOR`.

---

## 4. Phân quyền người dùng & Bảo mật (RBAC & Auth)

Hệ thống áp dụng cơ chế phân quyền 3 cấp độ (Role-Based Access Control) thông qua Decorator `@Roles(...)` và `RolesGuard`:

| Chức Năng / Nghiệp Vụ | `ADMIN` (Quản trị viên) | `OPERATOR` (Cán bộ vận hành) | `VIEWER` (Khách quan sát) |
| :--- | :---: | :---: | :---: |
| **Xem Bản đồ GIS & Dashboard Realtime** | ✅ Toàn quốc | ✅ Toàn quốc / Đập phụ trách | ✅ Chỉ xem |
| **Quản lý Đập & Trạm (Tạo/Sửa/Xóa)** | ✅ Toàn quyền | ❌ | ❌ |
| **Quản lý Gateway, Node, Cảm biến, Camera** | ✅ Toàn quyền | ✅ Chỉ đập được phân công (`assignedDamId`) | ❌ |
| **Cấu hình Ngưỡng cảnh báo (Thresholds)** | ✅ Toàn quyền | ✅ Chỉ đập được phân công | ❌ |
| **Trung tâm Cảnh báo & Gửi Email khẩn cấp** | ✅ Toàn quyền | ✅ Đập phụ trách | ❌ |
| **Xác nhận & Khắc phục Sự cố Cảnh báo** | ✅ Toàn quyền | ✅ Đập phụ trách | ❌ |
| **Xem & Xuất Nhật ký Hệ thống (Audit Logs)** | ✅ Toàn quyền | ❌ | ❌ |
| **Quản lý & Duyệt Tài khoản Cán bộ** | ✅ Toàn quyền | ❌ | ❌ |

---

## 5. Quy chuẩn định danh thiết bị (Naming Convention A.3.2)

Hệ thống tích hợp bộ sinh mã tự động và kiểm tra tính hợp lệ (`validateDeviceId`):

- **Gateway ID**: `GTW-[STATION_CODE]-[SEQ_ID]` (Ví dụ: `GTW-ST01-TX2A`). Khi chuyển trạm, Gateway được tự động đổi mã và dọn dẹp retained MQTT message cũ.
- **Node ID**: `NOD-[STATION_CODE]-[GATEWAY_SEQ]-[NODE_SEQ]` (Ví dụ: `NOD-ST01-TX2A-N01`).
- **Sensor ID**: `SEN-[STATION_CODE]-[GATEWAY_SEQ]-[NODE_SEQ]-[TYPE]` (Ví dụ: `SEN-ST01-TX2A-N01-VIB`).
- **Camera ID**: `CAM-[STATION_CODE]-[GATEWAY_SEQ]-[SEQ]` (Ví dụ: `CAM-ST01-TX2A-C01`).

---

## 6. Hạ tầng IoT, MQTT & WebSocket Real-time

### 6.1 Các chủ đề MQTT (Topics)
- `telemetry/gateway/{gatewayId}/node/{nodeId}`: Gửi dữ liệu đo đạc cảm biến định kỳ từ ESP32 qua Gateway.
- `heartbeat/gateway/{gatewayId}`: Gateway gửi gói tin nhịp tim kiểm tra trạng thái Online/Offline.
- `config/gateway/{gatewayId}/update`: Backend phát cấu hình mới (JSON Retained) khi Admin/Operator thay đổi cấu hình thiết bị.
- `alert/gateway/{gatewayId}/node/{nodeId}`: Gateway gửi tín hiệu báo động khi phát hiện vượt ngưỡng hoặc nứt vỡ từ AI.

### 6.2 Đồng bộ cấu hình Jetson TX2
- Endpoint: `GET /api/gateway/:id/config` (Yêu cầu Header `x-gateway-api-key`).
- Trả về danh sách Sensor Nodes, danh sách Camera CSI/RTSP và thông số kích hoạt AI.

### 6.3 WebSocket Gateway (Socket.IO)
- Namespace: `/`
- Sự kiện phát:
  - `sensor_update`: Truyền dữ liệu cảm biến mới nhất tới client.
  - `alarm_alert`: Phát sự kiện cảnh báo khẩn cấp (kích hoạt âm thanh và cảnh báo đỏ trên giao diện).
  - `gateway_status`: Cập nhật trạng thái kết nối phần cứng.

---

## 7. Danh mục REST API Endpoints

### 🔐 Xác thực & Người dùng (`/api/auth`, `/api/users`)
- `POST /api/auth/register`: Đăng ký tài khoản (Người dùng mới có trạng thái `PENDING_APPROVAL`).
- `POST /api/auth/login`: Đăng nhập, trả về Access Token JWT và thông tin Role.
- `GET /api/auth/me`: Lấy thông tin tài khoản hiện tại.
- `GET /api/users`: Quản lý danh sách người dùng (Chỉ ADMIN).
- `PUT /api/users/:id/status`: Duyệt/Từ chối tài khoản hoặc gán Đập phụ trách (`assignedDamId`).
- `PUT /api/users/:id/role`: Thay đổi quyền hạn tài khoản.

### 🌊 Quản lý Đập & Trạm (`/api/dams`, `/api/stations`)
- `GET /api/dams`: Danh sách đập thủy điện kèm thông số thủy văn.
- `GET /api/dams/:id`: Chi tiết đập thủy điện.
- `POST /api/dams`, `PUT /api/dams/:id`, `DELETE /api/dams/:id`: CRUD đập thủy điện (Chỉ ADMIN).
- `GET /api/stations`: Danh sách trạm quan trắc (hỗ trợ lọc theo `damId`).
- `GET /api/stations/:id`: Chi tiết trạm quan trắc.
- `POST /api/stations`, `PUT /api/stations/:id`, `DELETE /api/stations/:id`: CRUD trạm quan trắc (Chỉ ADMIN).

### 🖥️ Gateway & Thiết bị Biên (`/api/gateways`)
- `GET /api/gateways`: Danh sách Gateway (ADMIN xem tất cả, OPERATOR tự động lọc theo đập phụ trách).
- `GET /api/gateways/:id`: Chi tiết Gateway.
- `POST /api/gateways`: Tạo Gateway mới (ADMIN & OPERATOR).
- `PUT /api/gateways/:id`: Cập nhật Gateway / Đổi trạm lắp đặt.
- `DELETE /api/gateways/:id`: Xóa Gateway khỏi hệ thống.
- `GET /api/gateway/:id/config`: Endpoint đồng bộ cấu hình cho Jetson TX2 vật lý.

### 📡 Sensor Nodes & Cảm biến (`/api/nodes`)
- `GET /api/nodes`: Danh sách Node (hỗ trợ lọc theo `gatewayId`, `damId`).
- `GET /api/nodes/:id`: Chi tiết Node và danh sách cảm biến gắn kèm.
- `POST /api/nodes`, `PUT /api/nodes/:id`, `DELETE /api/nodes/:id`: Quản lý Node.
- `PUT /api/nodes/:id/map-camera`: Gán Camera AI tương ứng với Node.
- `GET /api/nodes/:nodeId/sensors`: Danh sách cảm biến của Node.
- `POST /api/nodes/:nodeId/sensors`, `PUT /api/nodes/:nodeId/sensors/:sensorId`, `DELETE /api/nodes/:nodeId/sensors/:sensorId`: Quản lý cảm biến.

### 📷 Camera & Bằng chứng AI (`/api/cameras`, `/api/evidence`)
- `GET /api/cameras`: Danh sách camera CSI / RTSP.
- `POST /api/cameras`, `PUT /api/cameras/:id`, `DELETE /api/cameras/:id`: Quản lý camera.
- `POST /api/evidence/upload`: Nhận ảnh chụp từ Jetson TX2 và upload lên MinIO S3.
- `POST /api/evidence/ai-result`: Tiếp nhận kết quả nhận diện vết nứt từ mô hình AI.

### 🚨 Cảnh Báo & Lịch Sử (`/api/sensors`, `/api/audit-logs`)
- `GET /api/sensors/alarms`: Danh sách sự kiện cảnh báo vượt ngưỡng.
- `PUT /api/sensors/alarms/:id/resolve`: Xác nhận đã khắc phục sự cố cảnh báo.
- `POST /api/sensors/send-email-alert`: Gửi Email cảnh báo khẩn cấp tới cán bộ phụ trách.
- `GET /api/sensors/history`: Truy vấn dữ liệu lịch sử đo đạc chuỗi thời gian.
- `GET /api/sensors/history-kpi`: Thống kê KPI lịch sử (Mực nước đỉnh, thời gian phản ứng).
- `GET /api/audit-logs`: Danh sách nhật ký thao tác hệ thống (Chỉ ADMIN).

---

## 8. Cấu hình biến môi trường (.env)

Tạo file `.env` tại thư mục gốc của backend:

```env
# ── Cổng dịch vụ ──
PORT=3001

# ── Xác thực JWT ──
JWT_SECRET=dam_monitoring_secure_jwt_secret_key_at_least_32_chars
ADMIN_BOOTSTRAP_PASSWORD=Admin@123456

# ── Cơ sở dữ liệu TimescaleDB / PostgreSQL ──
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=dam_monitoring

# ── MinIO Object Storage (Lưu ảnh camera) ──
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_INTERNAL_ENDPOINT=http://127.0.0.1:9000
MINIO_BUCKET=dam-images

# ── MQTT Broker (Mosquitto) ──
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_SENSOR_TOPIC=dam/sensor/all

# ── Xác thực Thiết bị biên Jetson TX2 ──
GATEWAY_API_KEY=tx2_secret_api_key_2026

# ── Cấu hình Email SMTP Cảnh báo ──
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
DEFAULT_ALERT_EMAIL=manager@dam-safety.vn
```

---

## 9. Hướng dẫn cài đặt & Khởi chạy

### 9.1 Chạy toàn bộ hệ sinh thái với Docker Compose (Khuyến nghị)

Khởi động đồng thời TimescaleDB, MinIO, Mosquitto MQTT, Pgweb và Backend:

```bash
docker compose up -d --build
```

- Backend API: `http://localhost:3001`
- MinIO Web Console: `http://localhost:9001` (User/Pass: `minioadmin` / `minioadmin`)
- Pgweb Database UI: `http://localhost:8081`
- Mosquitto MQTT Broker: `localhost:1883`

### 9.2 Chạy môi trường phát triển (Local Development)

1. Cài đặt các gói phụ thuộc:
```bash
npm install
```

2. Khởi động hạ tầng cơ sở dữ liệu (TimescaleDB, MinIO, MQTT):
```bash
docker compose up -d timescaledb minio minio-init mosquitto
```

3. Khởi chạy Backend ở chế độ Watch Mode:
```bash
npm run start:dev
```

4. Build ứng dụng Production:
```bash
npm run build
npm run start:prod
```

---

## 10. Kiểm thử tự động (Testing)

Hệ thống tích hợp quy trình kiểm thử chất lượng cao với Jest:

```bash
# Chạy Unit Tests
npm run test:unit

# Chạy Integration Tests
npm run test:int

# Chạy E2E Tests
npm run test:e2e

# Chạy toàn bộ Test Suite và xuất báo cáo
npm run test:all
npm run test:report
```
