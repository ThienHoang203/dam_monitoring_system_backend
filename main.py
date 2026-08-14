import os
import cv2
import httpx
import json
import sqlite3
import subprocess
import threading
import uuid
import time
import queue
import logging
import warnings
import multiprocessing as mp
import numpy as np
import paho.mqtt.client as mqtt
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

warnings.filterwarnings("ignore", message=".*_floordiv_ is deprecated.*")

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("edge")

# ================= CONFIGURATION =================
GATEWAY_ID = "GTW-ST01-TX2A"
MACHINE_A_IP = "192.168.1.93"
BACKEND_API_URL = f"http://{MACHINE_A_IP}:3001/api"

LOCAL_MQTT_HOST = "127.0.0.1"
LOCAL_MQTT_PORT = 1883
CLOUD_MQTT_HOST = MACHINE_A_IP
CLOUD_MQTT_PORT = 1883

MODEL_PATH = "train-0-3.pt"
FALLBACK_IMAGE_PATH = "Cracking-Control-in-Dam.webp"
PREDICT_TIMEOUT_SEC = 15.0  # timeout cho 1 lần model.predict, tránh treo cả pipeline AI
BUSY_NODE_TIMEOUT_SEC = 30.0  # watchdog: force-release busy_nodes nếu quá lâu không có kết quả
EDGE_DB_PATH = "edge_state.db"  # Cơ sở dữ liệu SQLite lưu trạng thái Edge bền vững


# ================= SQLITE PERSISTENT STORAGE =================
class EdgeStateDB:
    """
    Quản lý lưu trữ trạng thái Edge cục bộ trên Jetson TX2 bằng SQLite.
    Bảo vệ dữ liệu cửa sổ trượt, khóa node và hàng đợi upload khi mất điện/restart.
    """

    def __init__(self, db_path: str = EDGE_DB_PATH):
        self.db_path = db_path
        self.lock = threading.Lock()
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path, timeout=15.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def _init_db(self):
        with self.lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sliding_window (
                    node_id TEXT NOT NULL,
                    timestamp_sec REAL NOT NULL,
                    ppv REAL NOT NULL
                );
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_window_node_ts 
                ON sliding_window (node_id, timestamp_sec);
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS busy_nodes (
                    node_id TEXT PRIMARY KEY,
                    locked_at REAL NOT NULL,
                    event_id TEXT
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS upload_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT UNIQUE,
                    node_id TEXT,
                    local_path TEXT,
                    gateway_id TEXT,
                    confidence REAL,
                    threshold_val REAL,
                    measured_val REAL,
                    timestamp TEXT,
                    attempts INTEGER DEFAULT 0,
                    created_at REAL NOT NULL
                );
            """)
            conn.commit()

    def record_vibration_sample(self, node_id: str, timestamp_sec: float, ppv: float, window_size_sec: float = 10.0):
        with self.lock, self._get_conn() as conn:
            cutoff = timestamp_sec - window_size_sec
            conn.execute(
                "DELETE FROM sliding_window WHERE node_id = ? AND timestamp_sec < ?",
                (node_id, cutoff),
            )
            conn.execute(
                "INSERT INTO sliding_window (node_id, timestamp_sec, ppv) VALUES (?, ?, ?)",
                (node_id, timestamp_sec, ppv),
            )
            conn.commit()

    def get_sliding_window_timestamps(self, node_id: str, cutoff_sec: float) -> list:
        with self.lock, self._get_conn() as conn:
            cursor = conn.execute(
                "SELECT timestamp_sec FROM sliding_window WHERE node_id = ? AND timestamp_sec >= ? ORDER BY timestamp_sec ASC",
                (node_id, cutoff_sec),
            )
            return [row[0] for row in cursor.fetchall()]

    def set_busy_node(self, node_id: str, locked_at: float, event_id: str = ""):
        with self.lock, self._get_conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO busy_nodes (node_id, locked_at, event_id) VALUES (?, ?, ?)",
                (node_id, locked_at, event_id),
            )
            conn.commit()

    def release_busy_node(self, node_id: str):
        with self.lock, self._get_conn() as conn:
            conn.execute("DELETE FROM busy_nodes WHERE node_id = ?", (node_id,))
            conn.commit()

    def get_active_busy_nodes(self, max_age_sec: float = 30.0) -> dict:
        now = time.time()
        with self.lock, self._get_conn() as conn:
            cursor = conn.execute(
                "SELECT node_id, locked_at FROM busy_nodes WHERE (? - locked_at) <= ?",
                (now, max_age_sec),
            )
            active = {row[0]: row[1] for row in cursor.fetchall()}
            conn.execute("DELETE FROM busy_nodes WHERE (? - locked_at) > ?", (now, max_age_sec))
            conn.commit()
            return active

    def enqueue_upload(
        self,
        event_id: str,
        node_id: str,
        local_path: str,
        gateway_id: str,
        confidence: float,
        threshold_val: float,
        measured_val: float,
        timestamp: str,
    ):
        with self.lock, self._get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO upload_queue 
                (event_id, node_id, local_path, gateway_id, confidence, threshold_val, measured_val, timestamp, attempts, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (event_id, node_id, local_path, gateway_id, confidence, threshold_val, measured_val, timestamp, time.time()),
            )
            conn.commit()

    def get_pending_uploads(self, limit: int = 10) -> list:
        with self.lock, self._get_conn() as conn:
            cursor = conn.execute(
                "SELECT id, event_id, node_id, local_path, gateway_id, confidence, threshold_val, measured_val, timestamp, attempts FROM upload_queue ORDER BY id ASC LIMIT ?",
                (limit,),
            )
            return cursor.fetchall()

    def remove_upload(self, upload_id: int):
        with self.lock, self._get_conn() as conn:
            conn.execute("DELETE FROM upload_queue WHERE id = ?", (upload_id,))
            conn.commit()

    def increment_upload_attempt(self, upload_id: int):
        with self.lock, self._get_conn() as conn:
            conn.execute("UPDATE upload_queue SET attempts = attempts + 1 WHERE id = ?", (upload_id,))
            conn.commit()


# ================= VIBRATION SLIDING WINDOW EVALUATOR =================
class VibrationWindowEvaluator:
    """
    Tái tạo chuẩn xác logic kiểm tra vượt ngưỡng độ rung (PPV mm/s)
    theo thuật toán Cửa Sổ Trượt (Sliding Window 10s) kết hợp lưu trữ bền vững SQLite.
    """

    def __init__(self, db: EdgeStateDB, window_size_sec: float = 10.0, alert_min_count: int = 4):
        self.db = db
        self.window_size_sec = window_size_sec
        self.alert_min_count = alert_min_count

    def evaluate(
        self,
        node_id: str,
        ppv: float,
        timestamp_sec: float,
        warn_high: float = 2.5,
        alert_high: float = 15.0,
        critical_high: float = 25.0,
    ):
        """
        Đánh giá giá trị độ rung PPV (mm/s):
        - CRITICAL (>= critical_high): Nguy hiểm lập tức, kích hoạt cảnh báo ngay (breach = True).
        - ALERT (>= alert_high): Cần xuất hiện ít nhất alert_min_count (4 lần) trong 10s mới kích hoạt (breach = True).
        - WARNING (>= warn_high): Mức theo dõi (breach = False).
        - NORMAL (< warn_high): Trạng thái an toàn (breach = False).

        Trả về: (breach: bool, severity: str, duration_sec: float)
        """
        # 1. KIỂM TRA MỨC NGUY CẤP (CRITICAL) - Nguy hiểm lập tức
        if ppv >= critical_high:
            log.warning(
                f"[Threshold] Node {node_id} VƯỢT NGƯỠNG NGUY CẤP: {ppv} mm/s >= {critical_high} mm/s"
            )
            return True, "CRITICAL", 0.0

        cutoff = timestamp_sec - self.window_size_sec

        # 2. KIỂM TRA MỨC BÁO ĐỘNG (ALERT)
        if ppv >= alert_high:
            # Ghi nhận mốc thời gian vi phạm vào SQLite
            self.db.record_vibration_sample(node_id, timestamp_sec, ppv, self.window_size_sec)
            timestamps = self.db.get_sliding_window_timestamps(node_id, cutoff)
            duration_sec = timestamp_sec - timestamps[0] if timestamps else 0.0

            # Kiểm tra mật độ lỗi trong cửa sổ 10s
            if len(timestamps) >= self.alert_min_count:
                log.warning(
                    f"[Threshold] Node {node_id} VƯỢT NGƯỠNG BÁO ĐỘNG LIÊN TIẾP: {ppv} mm/s ({len(timestamps)}/10s)"
                )
                return True, "ALERT", duration_sec

            log.info(
                f"[Threshold] Node {node_id} chớm vượt ngưỡng ALERT ({ppv} mm/s), tần suất {len(timestamps)}/{self.alert_min_count} lần trong 10s."
            )
            return False, "WARNING", duration_sec

        # 3. KIỂM TRA MỨC THEO DÕI (WARNING)
        if ppv >= warn_high:
            return False, "WARNING", 0.0

        # 4. TRẠNG THÁI BÌNH THƯỜNG (NORMAL)
        return False, "NORMAL", 0.0


# ================= AI WORKER (chạy trong PROCESS riêng) =================
def ai_worker_process(trigger_q: mp.Queue, result_q: mp.Queue):
    """
    Chạy trong process riêng biệt (không share GIL với main process),
    nhờ đó vòng lặp MQTT ở main process không bao giờ bị nghẽn khi AI
    đang predict/capture ảnh. Xử lý tuần tự từng trigger lấy từ queue.
    """
    from ultralytics import YOLO

    try:
        model = YOLO(MODEL_PATH, task="segment")
        dummy = np.zeros((720, 1280, 3), dtype=np.uint8)
        model.predict(source=dummy, device=0, imgsz=640, verbose=False)
        print("[AI Worker] Model loaded & warmed up.")
    except Exception as e:
        print(f"[AI Worker] Failed to load model: {e}")
        model = None

    while True:
        task = trigger_q.get()  # block tới khi có trigger
        if task is None:
            break

        node_id, trigger_value, severity, duration_sec, node_config, camera_config = task
        camera_id = node_config.get("camera_id")
        local_image_path = f"temp_{camera_id}_{int(time.time())}.jpg"
        frame = None
        cam_type = camera_config.get("camera_type")
        event_id = str(uuid.uuid4())
        threshold_val = float(node_config.get("alert_high", node_config.get("threshold", 15.0)))

        try:
            if cam_type == "CSI":
                result = subprocess.run(
                    [
                        "gst-launch-1.0",
                        "nvarguscamerasrc",
                        "num-buffers=1",
                        "!",
                        "video/x-raw(memory:NVMM),width=1280,height=720,framerate=120/1",
                        "!",
                        "nvvidconv",
                        "!",
                        "jpegenc",
                        "!",
                        "filesink",
                        f"location={local_image_path}",
                    ],
                    capture_output=True,
                    timeout=10,
                )
                if result.returncode == 0 and os.path.exists(local_image_path):
                    frame = cv2.imread(local_image_path)

            elif cam_type == "IP":
                stream_url = camera_config.get("stream_url")
                if stream_url:
                    cap = cv2.VideoCapture(stream_url)
                    ret, frame = cap.read()
                    cap.release()
                    if ret:
                        cv2.imwrite(local_image_path, frame)

            if frame is None:
                print(f"[AI Worker] Capture failed for {camera_id}, using fallback image.")
                if os.path.exists(FALLBACK_IMAGE_PATH):
                    frame = cv2.imread(FALLBACK_IMAGE_PATH)
                    cv2.imwrite(local_image_path, frame)
                else:
                    result_q.put({
                        "event_id": event_id,
                        "node_id": node_id,
                        "camera_id": camera_id,
                        "severity": severity,
                        "measured_val": trigger_value,
                        "threshold": threshold_val,
                        "duration_sec": duration_sec,
                        "crack_detected": False,
                        "confidence": 0.0,
                        "crack_size": 0.0,
                        "timestamp": datetime.utcnow().isoformat(),
                        "image_path": None,
                        "ai_failed": True,
                        "error": "no_frame_and_no_fallback",
                    })
                    continue

            crack_detected = False
            max_confidence = 0.0
            crack_size_estimation = 0.0

            if model:
                with ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(
                        model.predict,
                        source=frame, device=0, imgsz=640, conf=0.25, verbose=False,
                    )
                    try:
                        results = future.result(timeout=PREDICT_TIMEOUT_SEC)
                    except FutureTimeoutError:
                        print(f"[AI Worker] Predict timeout ({PREDICT_TIMEOUT_SEC}s) cho node {node_id}, bỏ qua trigger này.")
                        result_q.put({
                            "event_id": event_id,
                            "node_id": node_id,
                            "camera_id": camera_id,
                            "severity": severity,
                            "measured_val": trigger_value,
                            "threshold": threshold_val,
                            "duration_sec": duration_sec,
                            "crack_detected": False,
                            "confidence": 0.0,
                            "crack_size": 0.0,
                            "timestamp": datetime.utcnow().isoformat(),
                            "image_path": local_image_path,
                            "ai_failed": True,
                            "error": "predict_timeout",
                        })
                        continue

                for res in results:
                    if res.masks is not None and len(res.masks) > 0:
                        crack_detected = True
                        max_confidence = float(max(res.boxes.conf.tolist()))
                        crack_size_estimation = float(res.masks.data.sum())
                        annotated = res.plot()
                        cv2.imwrite(local_image_path, annotated)
                        break

            result_q.put(
                {
                    "event_id": event_id,
                    "node_id": node_id,
                    "camera_id": camera_id,
                    "severity": severity,
                    "measured_val": trigger_value,
                    "threshold": threshold_val,
                    "duration_sec": duration_sec,
                    "crack_detected": crack_detected,
                    "confidence": max_confidence,
                    "crack_size": crack_size_estimation,
                    "timestamp": datetime.utcnow().isoformat(),
                    "image_path": local_image_path,
                    "ai_failed": False,
                }
            )

        except Exception as e:
            print(f"[AI Worker] Error processing trigger for {node_id}: {e}")
            if os.path.exists(local_image_path):
                os.remove(local_image_path)
            result_q.put({
                "event_id": event_id,
                "node_id": node_id,
                "camera_id": camera_id,
                "severity": severity,
                "measured_val": trigger_value,
                "threshold": threshold_val,
                "duration_sec": duration_sec,
                "crack_detected": False,
                "confidence": 0.0,
                "crack_size": 0.0,
                "timestamp": datetime.utcnow().isoformat(),
                "image_path": None,
                "ai_failed": True,
                "error": str(e),
            })


# ================= MAIN GATEWAY =================
class EdgeGateway:
    def __init__(self):
        self.db = EdgeStateDB(EDGE_DB_PATH)
        self.config_cache = {}
        self.config_lock = threading.Lock()

        # Bộ kiểm tra vượt ngưỡng độ rung theo cửa sổ trượt 10s có SQLite persistence
        self.vibration_evaluator = VibrationWindowEvaluator(
            db=self.db, window_size_sec=10.0, alert_min_count=4
        )

        # Debounce theo từng node. Khôi phục từ SQLite khi khởi động lại
        self.trigger_lock = threading.Lock()
        self.busy_nodes = self.db.get_active_busy_nodes(max_age_sec=BUSY_NODE_TIMEOUT_SEC)

        self.trigger_q = mp.Queue(maxsize=5)  # Giới hạn queue để tránh dồn ứ
        self.result_q = mp.Queue()

        self.local_mqtt = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION1, client_id=f"{GATEWAY_ID}_Local"
        )
        self.local_mqtt.on_connect = self.on_local_connect
        self.local_mqtt.on_message = self.on_local_message

        self.cloud_mqtt = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION1, client_id=f"{GATEWAY_ID}_Cloud"
        )
        self.cloud_mqtt.on_connect = self.on_cloud_connect
        self.cloud_mqtt.on_message = self.on_cloud_message

        self.ai_process = None

    # ---------- helper: publish cloud MQTT có kiểm tra kết quả ----------
    def safe_cloud_publish(self, topic: str, payload: str):
        """Publish lên cloud MQTT, log rõ khi thất bại thay vì âm thầm mất dữ liệu."""
        try:
            info = self.cloud_mqtt.publish(topic, payload)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                log.warning(f"Cloud MQTT publish thất bại (rc={info.rc}) topic={topic}")
        except Exception as e:
            log.error(f"Cloud MQTT publish exception topic={topic}: {e}")

    # ---------- watchdog: force-release busy_nodes bị kẹt & kiểm tra AI process ----------
    def watchdog_loop(self):
        while True:
            time.sleep(5)
            now = time.time()
            with self.trigger_lock:
                stuck = [
                    n for n, ts in self.busy_nodes.items()
                    if now - ts > BUSY_NODE_TIMEOUT_SEC
                ]
                for n in stuck:
                    log.warning(
                        f"Node {n} busy quá {BUSY_NODE_TIMEOUT_SEC}s không có kết quả AI, force-release."
                    )
                    del self.busy_nodes[n]
                    self.db.release_busy_node(n)

            if self.ai_process is not None and not self.ai_process.is_alive():
                log.error("AI worker process đã chết, khởi động lại...")
                self.ai_process = mp.Process(
                    target=ai_worker_process,
                    args=(self.trigger_q, self.result_q),
                    daemon=True,
                )
                self.ai_process.start()

    # ---------- config ----------
    def load_mock_config(self):
        with self.config_lock:
            self.config_cache = {
                "nodes": {
                    "NOD-ST01-ESP01": {
                        "camera_id": "CAM-CSI-ST01-01",
                        "threshold": 15.0,
                        "warn_high": 2.5,
                        "alert_high": 15.0,
                        "critical_high": 25.0,
                    }
                },
                "cameras": {"CAM-CSI-ST01-01": {"camera_type": "CSI"}},
            }
        log.info("Loaded MOCK configuration for local testing.")

    def fetch_initial_config(self):
        try:
            log.info(f"OUT -> GET {BACKEND_API_URL}/gateway/{GATEWAY_ID}/config")
            resp = httpx.get(
                f"{BACKEND_API_URL}/gateway/{GATEWAY_ID}/config", timeout=10.0
            )
            if resp.status_code == 200:
                with self.config_lock:
                    self.config_cache = resp.json()
                log.info("Initial configuration synced from Backend.")
            else:
                log.warning(
                    f"Failed to fetch config. Status: {resp.status_code}. Using mock."
                )
                self.load_mock_config()
        except Exception as e:
            log.warning(f"HTTP connection error: {e}. Using mock config.")
            self.load_mock_config()

    # ---------- upload worker (SQLite backed retry loop) ----------
    def evidence_upload_worker(self):
        """
        Upload worker có retry và đối soát qua SQLite:
        Đảm bảo không bao giờ mất ảnh evidence khi backend hoặc kết nối mạng bị gián đoạn.
        """
        while True:
            try:
                pending = self.db.get_pending_uploads(limit=5)
                if not pending:
                    time.sleep(1.0)
                    continue

                for row in pending:
                    upload_id, event_id, node_id, local_path, gateway_id, confidence, threshold_val, measured_val, timestamp, attempts = row

                    if not local_path or not os.path.exists(local_path):
                        log.warning(f"[Upload] File ảnh {local_path} không tồn tại, bỏ qua task {event_id}.")
                        self.db.remove_upload(upload_id)
                        continue

                    try:
                        with open(local_path, "rb") as f:
                            files = {"file": (os.path.basename(local_path), f, "image/jpeg")}
                            data = {
                                "event_id": event_id,
                                "gateway_id": gateway_id,
                                "node_id": node_id or "",
                                "confidence": str(confidence or 0.0),
                                "threshold_val": str(threshold_val or 15.0),
                                "measured_val": str(measured_val or 0.0),
                                "timestamp": timestamp,
                            }
                            resp = httpx.post(
                                f"{BACKEND_API_URL}/evidence/upload",
                                files=files,
                                data=data,
                                timeout=20.0,
                            )
                            if resp.status_code in (200, 201):
                                log.info(f"[Upload] Upload evidence thành công cho event {event_id}.")
                                if os.path.exists(local_path):
                                    os.remove(local_path)
                                self.db.remove_upload(upload_id)
                            else:
                                log.error(f"[Upload] Backend từ chối upload (HTTP {resp.status_code}): {resp.text}")
                                self.db.increment_upload_attempt(upload_id)
                                time.sleep(2.0)
                    except Exception as e:
                        log.error(f"[Upload] Lỗi kết nối khi upload {local_path}: {e}")
                        self.db.increment_upload_attempt(upload_id)
                        time.sleep(3.0)

            except Exception as loop_err:
                log.error(f"[Upload Worker] Loop error: {loop_err}")
                time.sleep(2.0)

    # ---------- consumer đọc kết quả AI từ process riêng ----------
    def ai_result_consumer(self):
        while True:
            res = self.result_q.get()
            node_id = res["node_id"]
            event_id = res["event_id"]

            with self.trigger_lock:
                self.busy_nodes.pop(node_id, None)
                self.db.release_busy_node(node_id)

            if res.get("ai_failed"):
                log.error(f"AI xử lý thất bại cho node {node_id}, event {event_id}: {res.get('error')}")
                continue

            topic = f"events/gateway/{GATEWAY_ID}/anomaly"
            payload_str = json.dumps(
                {
                    "event_id": event_id,
                    "gateway_id": GATEWAY_ID,
                    "node_id": node_id,
                    "camera_id": res["camera_id"],
                    "severity": res["severity"],
                    "measured_val": res["measured_val"],
                    "duration_sec": res["duration_sec"],
                    "crack_detected": res["crack_detected"],
                    "confidence": res["confidence"],
                    "crack_size": res["crack_size"],
                    "timestamp": res["timestamp"],
                }
            )
            self.safe_cloud_publish(topic, payload_str)
            log.info(f"Cloud MQTT OUT -> {topic} (Severity: {res['severity']}, Crack: {res['crack_detected']})")

            # Ghi vào hàng đợi upload SQLite bền vững
            if res["image_path"] and os.path.exists(res["image_path"]):
                self.db.enqueue_upload(
                    event_id=event_id,
                    node_id=node_id,
                    local_path=res["image_path"],
                    gateway_id=GATEWAY_ID,
                    confidence=res["confidence"],
                    threshold_val=res.get("threshold", 15.0),
                    measured_val=res["measured_val"],
                    timestamp=res["timestamp"],
                )

    # ---------- local mqtt (ESP32) ----------
    def on_local_connect(self, client, userdata, flags, rc):
        log.info("Local MQTT connected. Subscribing to local sensors...")
        client.subscribe("local/node/+/sensor/+")

    def on_local_message(self, client, userdata, msg):
        try:
            payload_str = msg.payload.decode()
            topic_parts = msg.topic.split("/")
            if len(topic_parts) < 5:
                return

            node_id = topic_parts[2]
            sensor_type = topic_parts[4]
            payload = json.loads(payload_str)

            # 1. Chuyển tiếp (Relay) dữ liệu cảm biến thô lên Cloud MQTT cho Backend vẽ biểu đồ thời gian thực
            cloud_topic = f"telemetry/gateway/{GATEWAY_ID}/node/{node_id}/{sensor_type}"
            self.safe_cloud_publish(cloud_topic, payload_str)

            # 2. Xử lý logic kiểm tra vượt ngưỡng độ rung
            if sensor_type == "vibration":
                vibration_value = float(payload.get("value", payload.get("amp", 0.0)))
                now_ts = time.time()

                # Trích xuất cấu hình ngưỡng từ cache
                with self.config_lock:
                    node_config = self.config_cache.get("nodes", {}).get(node_id)
                    if node_config is None:
                        log.warning(f"Node {node_id} chưa có config, bỏ qua đánh giá ngưỡng.")
                        return
                    warn_high = float(node_config.get("warn_high", 2.5))
                    alert_high = float(node_config.get("alert_high", node_config.get("threshold", 15.0)))
                    critical_high = float(node_config.get("critical_high", 25.0))

                    camera_id = node_config.get("camera_id")
                    camera_config = self.config_cache.get("cameras", {}).get(camera_id) if camera_id else None

                # ĐÁNH GIÁ THEO THUẬT TOÁN CỬA SỔ TRƯỢT 10S KẾT HỢP SQLITE PERSISTENCE
                breach, severity, duration_sec = self.vibration_evaluator.evaluate(
                    node_id=node_id,
                    ppv=vibration_value,
                    timestamp_sec=now_ts,
                    warn_high=warn_high,
                    alert_high=alert_high,
                    critical_high=critical_high,
                )

                # Luôn publish trạng thái ngưỡng (kể cả chưa breach) để dashboard/backend
                # theo dõi realtime, không chỉ raw sensor value.
                status_topic = f"status/gateway/{GATEWAY_ID}/node/{node_id}/vibration"
                self.safe_cloud_publish(
                    status_topic,
                    json.dumps(
                        {
                            "node_id": node_id,
                            "severity": severity,
                            "value": vibration_value,
                            "duration_sec": duration_sec,
                            "breach": breach,
                            "timestamp": datetime.utcnow().isoformat(),
                        }
                    ),
                )

                if not breach:
                    return

                # Vi phạm ngưỡng (ALERT đủ mật độ hoặc CRITICAL) -> cần ảnh để xác nhận
                if camera_config is None:
                    log.warning(
                        f"Node {node_id} breach ({severity}) nhưng thiếu camera_config, không thể chụp ảnh."
                    )
                    return

                with self.trigger_lock:
                    if node_id in self.busy_nodes:
                        log.info(f"Node {node_id} busy processing previous trigger, dropping new trigger.")
                        return
                    self.busy_nodes[node_id] = now_ts
                    self.db.set_busy_node(node_id, now_ts)

                try:
                    self.trigger_q.put_nowait(
                        (node_id, vibration_value, severity, duration_sec, node_config, camera_config)
                    )
                    log.info(f"Triggered AI Worker for node {node_id} (Severity: {severity}, Value: {vibration_value} mm/s)")
                except queue.Full:
                    log.warning("AI trigger queue full, dropping trigger.")
                    with self.trigger_lock:
                        self.busy_nodes.pop(node_id, None)
                        self.db.release_busy_node(node_id)

        except Exception as e:
            log.error(f"Error processing local message: {e}")

    # ---------- cloud mqtt (backend) ----------
    def on_cloud_connect(self, client, userdata, flags, rc):
        log.info("Cloud MQTT connected. Subscribing to config updates...")
        client.subscribe(f"config/gateway/{GATEWAY_ID}/update")

    def on_cloud_message(self, client, userdata, msg):
        try:
            payload_str = msg.payload.decode()
            if msg.topic == f"config/gateway/{GATEWAY_ID}/update":
                new_config = json.loads(payload_str)
                with self.config_lock:
                    self.config_cache = new_config
                log.info(f"[Config Sync] Cấu hình Gateway {GATEWAY_ID} đã được cập nhật thời gian thực qua MQTT.")
        except Exception as e:
            log.error(f"Error processing config update: {e}")

    # ---------- run ----------
    def run(self):
        log.info(f"--- Starting Edge Inference Service for {GATEWAY_ID} ---")
        self.fetch_initial_config()

        threading.Thread(target=self.evidence_upload_worker, daemon=True).start()
        threading.Thread(target=self.ai_result_consumer, daemon=True).start()
        threading.Thread(target=self.watchdog_loop, daemon=True).start()

        self.ai_process = mp.Process(
            target=ai_worker_process, args=(self.trigger_q, self.result_q), daemon=True
        )
        self.ai_process.start()

        while True:
            try:
                self.cloud_mqtt.connect(CLOUD_MQTT_HOST, CLOUD_MQTT_PORT, 60)
                self.cloud_mqtt.loop_start()
                break
            except Exception as e:
                log.warning(f"Failed to connect Cloud MQTT, retry in 5s... ({e})")
                time.sleep(5)

        while True:
            try:
                self.local_mqtt.connect(LOCAL_MQTT_HOST, LOCAL_MQTT_PORT, 60)
                self.local_mqtt.loop_forever()
            except KeyboardInterrupt:
                log.info("Shutting down Edge Gateway...")
                self.local_mqtt.disconnect()
                self.cloud_mqtt.disconnect()
                self.trigger_q.put(None)
                break
            except Exception as e:
                log.warning(f"Local Mosquitto not ready, retry in 5s... ({e})")
                time.sleep(5)


if __name__ == "__main__":
    mp.set_start_method("spawn", force=True)
    gateway = EdgeGateway()
    gateway.run()
