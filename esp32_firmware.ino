#include <Wire.h>
#include <MPU6050.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <arduinoFFT.h>

// ================= ĐỊNH NGHĨA STRUCT DỮ LIỆU =================
struct SensorData {
  double freq;
  double amp;            // Vận tốc rung PPV (mm/s)
  float waterLevel;      // Mực nước thực tế (cm)
  float moisturePercent; // % độ ẩm đất thực tế
};

// Queue FreeRTOS để truyền dữ liệu sang Task Network
QueueHandle_t sensorQueue;

// Biến toàn cục liên nhân (Core 0 cập nhật, Core 0/1 đọc)
volatile float latestWaterLevel = 0.0f;
volatile float latestMoisturePercent = 0.0f;

// ================= CẤU HÌNH HIỆU CHỈNH ĐỘ ẨM =================
const int DRY_VALUE = 3300;   
const int WET_VALUE = 1300;   

// ================= MPU6050 & FFT =================
#define SAMPLES 256
#define SAMPLING_FREQ 300
MPU6050 mpu;
double vReal[SAMPLES];
double vImag[SAMPLES];
ArduinoFFT<double> FFT = ArduinoFFT<double>(vReal, vImag, SAMPLES, SAMPLING_FREQ);

float ax_f = 0, ay_f = 0, az_f = 0;
float alpha_mpu = 0.8;

// Hằng số chuyển đổi vật lý từ LSB sang mm/s^2 (Cấu hình mặc định MPU6050: +/-2g -> 16384 LSB/g)
const double MPU6050_LSB_PER_G = 16384.0;
const double G_TO_MM_S2 = 9806.65; 
const double LSB_TO_MM_S2 = G_TO_MM_S2 / MPU6050_LSB_PER_G; // ~0.59855 mm/s^2 per LSB
const double FFT_NORM_FACTOR = 2.0 / SAMPLES;              // Chuẩn hóa biên độ AC cho Real FFT

// ================= WATER SENSOR (HC-SR04) =================
#define TRIG 5
#define ECHO 18
#define NUM_SAMPLES 5   
#define MIN_DISTANCE 25.0
float TANK_HEIGHT = 50.0;
float filtered_water = -1;
float alpha_water = 0.2;

// ================= MOISTURE SENSOR (v1.2) =================
#define MOISTURE_PIN 34
#define MOISTURE_POWER 25
#define MOISTURE_SAMPLES 5 
float moisture_filtered = -1;
float alpha_moisture = 0.15; 

// ================= WIFI & MQTT BROKER =================
const char* ssid = "Thuan Loi";
const char* password = "79797979";

// const char* ssid = "EIU FACULTY/STAFF";
// const char* password = "myEIU@#$%!";

const char* mqttServer = "192.168.1.93";
const int mqttPort = 1883;
const char* mqttTopic = "dam/sensor/all";

// ================= ĐỊNH DANH CỤM CẢM BIẾN =================
// Thay đổi giá trị này cho mỗi ESP32 khác nhau để backend nhận diện đúng cụm
const char* clusterId = "cluster_01";   // ID cụm cảm biến (phải khớp với DB)
const char* damId     = "dam_1";        // ID đập mà cụm này thuộc về

WiFiClient espClient;
PubSubClient mqttClient(espClient);

unsigned long lastWiFiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL = 10000;

unsigned long lastMqttRetry = 0;
const unsigned long MQTT_RETRY_INTERVAL = 5000;

// ================= HÀM KẾT NỐI MQTT PHI CHẶN (NON-BLOCKING) =================
void connectMqttNonBlocking() {
  if (mqttClient.connected()) {
    return;
  }
  
  unsigned long now = millis();
  if (now - lastMqttRetry >= MQTT_RETRY_INTERVAL) {
    lastMqttRetry = now;
    Serial.println("[Core 0] Attempting MQTT connection...");
    // Sử dụng clusterId làm MQTT Client ID để phân biệt các ESP32 khác nhau
    if (mqttClient.connect(clusterId)) {
      Serial.printf("[Core 0] MQTT connected as '%s'\n", clusterId);
    } else {
      Serial.printf("[Core 0] MQTT connection failed, rc=%d\n", mqttClient.state());
    }
  }
}

// ================= HÀM KẾT NỐI WIFI PHI CHẶN (NON-BLOCKING) =================
void connectWiFiNonBlocking() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  
  unsigned long now = millis();
  if (now - lastWiFiCheck >= WIFI_CHECK_INTERVAL) {
    lastWiFiCheck = now;
    Serial.println("[Core 0] WiFi lost. Reconnecting asynchronously...");
    WiFi.disconnect();
    WiFi.begin(ssid, password);
  }
}

// ================= HÀM BẢO VỆ CHỐNG LỖI JSON (NAN/INF) =================
double safeDouble(double val, double fallback = 0.0) {
  if (isnan(val) || isinf(val)) return fallback;
  return val;
}

float safeFloat(float val, float fallback = 0.0f) {
  if (isnan(val) || isinf(val)) return fallback;
  return val;
}

// ================= CÁC HÀM LOGIC ĐỌC CẢM BIẾN =================
float readRawDistance() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  
  long duration = pulseIn(ECHO, HIGH, 20000); 
  if (duration == 0) return -1;
  float d = duration * 0.034 / 2;
  return (d < MIN_DISTANCE) ? MIN_DISTANCE : d;
}

float waterMedianFilter() {
  float samples[NUM_SAMPLES];
  int count = 0;
  for (int i = 0; i < NUM_SAMPLES; i++) {
    float val = readRawDistance();
    if (val > 0) {
      samples[count++] = val;
    }
    
    // Bug B Fix: Thoát sớm nếu số mẫu còn lại không đủ để đạt mức tối thiểu (3 mẫu)
    if (count + (NUM_SAMPLES - 1 - i) < 3) {
      return -1; 
    }
    vTaskDelay(pdMS_TO_TICKS(10)); // Sử dụng delay phi chặn của FreeRTOS
  }
  
  for (int i = 0; i < count - 1; i++) {
    for (int j = i + 1; j < count; j++) {
      if (samples[i] > samples[j]) { float t = samples[i]; samples[i] = samples[j]; samples[j] = t; }
    }
  }
  return samples[count / 2];
}

float getMoisturePercent() {
  int arr[MOISTURE_SAMPLES];
  
  digitalWrite(MOISTURE_POWER, HIGH);
  vTaskDelay(pdMS_TO_TICKS(40)); // Ổn định cảm biến phi chặn
  
  for (int i = 0; i < MOISTURE_SAMPLES; i++) {
    arr[i] = analogRead(MOISTURE_PIN);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
  
  digitalWrite(MOISTURE_POWER, LOW); 

  for (int i = 0; i < MOISTURE_SAMPLES - 1; i++) {
    for (int j = i + 1; j < MOISTURE_SAMPLES; j++) {
      if (arr[i] > arr[j]) { int t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    }
  }
  int medianRaw = arr[MOISTURE_SAMPLES / 2];

  // Bug E Fix: Phát hiện hở mạch hoặc mất nguồn trước khi đưa vào bộ lọc EMA
  if (medianRaw < 300) {
    return 0.0f; 
  }

  if (moisture_filtered < 0) moisture_filtered = (float)medianRaw;
  else moisture_filtered = (alpha_moisture * medianRaw) + ((1 - alpha_moisture) * moisture_filtered);

  // Tính toán % độ ẩm cho cảm biến điện dung v1.2
  float percent = (float)(DRY_VALUE - moisture_filtered) / (DRY_VALUE - WET_VALUE) * 100.0f;
  return constrain(percent, 0.0f, 100.0f);
}

// ================= TASK 1: THU THẬP & XỬ LÝ RUNG ĐỘNG (CORE 1 - HIGH PRIORITY) =================
void TaskVibration(void *pvParameters) {
  (void) pvParameters;
  const TickType_t xSamplingPeriod = pdMS_TO_TICKS(1000 / SAMPLING_FREQ); 
  TickType_t xLastWakeTime = xTaskGetTickCount();
  int sampleIdx = 0;
  
  for (;;) {
    // Bug D Fix: Sử dụng cấu trúc vòng lặp phẳng để vTaskDelayUntil hoạt động liên tục, chuẩn xác 100Hz
    vTaskDelayUntil(&xLastWakeTime, xSamplingPeriod);

    int16_t ax, ay, az;
    mpu.getAcceleration(&ax, &ay, &az);
    
    ax_f = alpha_mpu * ax_f + (1 - alpha_mpu) * ax;
    ay_f = alpha_mpu * ay_f + (1 - alpha_mpu) * ay;
    az_f = alpha_mpu * az_f + (1 - alpha_mpu) * az;
    
    float ax_hp = ax - ax_f;
    float ay_hp = ay - ay_f;
    float az_hp = az - az_f;
    
    vReal[sampleIdx] = sqrt(ax_hp * ax_hp + ay_hp * ay_hp + az_hp * az_hp);
    vImag[sampleIdx] = 0;
    
    sampleIdx++;

    // Khi đã thu thập đủ cấu trúc block 128 mẫu
    if (sampleIdx >= SAMPLES) {
      FFT.windowing(FFT_WIN_TYP_HAMMING, FFT_FORWARD);
      FFT.compute(FFT_FORWARD);
      FFT.complexToMagnitude();
      
      double peakAmpRaw = 0;
      double peakFreq = 0;
      
      for (int i = 1; i < SAMPLES / 2; i++) {
        double currentFreq = (i * SAMPLING_FREQ) / SAMPLES;
        if (currentFreq >= 0.5 && currentFreq <= 10) {
          if (vReal[i] > peakAmpRaw) {
            peakAmpRaw = vReal[i];
            peakFreq = currentFreq;
          }
        }
      }

      SensorData dataToSend;
      dataToSend.freq = peakFreq;
      
      // Bug A Fix: Chuyển đổi từ biên độ gia tốc vật lý miền tần số sang vận tốc PPV: v = a / (2 * pi * f)
      if (peakFreq > 0.5) {
        double peakAccel_mm_s2 = (peakAmpRaw * FFT_NORM_FACTOR) * LSB_TO_MM_S2;
        dataToSend.amp = peakAccel_mm_s2 / (2.0 * PI * peakFreq);
        // dataToSend.amp =17.5;
      } else {
        dataToSend.amp = 0.0;
      }

      // Bug C Fix: Loại bỏ việc lấy dữ liệu môi trường tại đây để tránh lệch pha thời gian.

      // Đẩy dữ liệu vào Queue
      if (xQueueSend(sensorQueue, &dataToSend, 0) != pdPASS) {
        SensorData dummy;
        xQueueReceive(sensorQueue, &dummy, 0); 
        xQueueSend(sensorQueue, &dataToSend, 0);
      }
      
      sampleIdx = 0;
      // Reset lại mốc thời gian để bù trừ lượng thời gian đã tiêu tốn cho thuật toán FFT chuyên sâu
      xLastWakeTime = xTaskGetTickCount();
    }
  }
}

// ================= TASK 2: ĐỌC CẢM BIẾN MÔI TRƯỜNG CHẬM (CORE 0 - LOW PRIORITY) =================
void TaskEnvironment(void *pvParameters) {
  (void) pvParameters;
  for (;;) {
    float distance = waterMedianFilter();
    if (distance > 0) {
      if (filtered_water < 0) filtered_water = distance;
      else filtered_water = (alpha_water * distance) + (1 - alpha_water) * filtered_water;
    }
    
    if (filtered_water >= 0) {
      latestWaterLevel = max(0.0f, TANK_HEIGHT - filtered_water);
    } else {
      latestWaterLevel = 0.0f;
    }

    latestMoisturePercent = getMoisturePercent();

    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

// ================= TASK 3: TRUYỀN THÔNG MẠNG & GỬI DATA (CORE 0 - NORMAL PRIORITY) =================
void TaskNetwork(void *pvParameters) {
  (void) pvParameters;
  SensorData receivedData;
  char jsonBuffer[384]; 

  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      connectMqttNonBlocking();
      mqttClient.loop();
    }

    if (xQueueReceive(sensorQueue, &receivedData, pdMS_TO_TICKS(100)) == pdPASS) {
      // Bug C Fix: Thực hiện gán đồng bộ giá trị môi trường mới nhất ngay khi chuẩn bị đẩy gói tin mạng
      receivedData.waterLevel = latestWaterLevel;
      receivedData.moisturePercent = latestMoisturePercent;

      connectWiFiNonBlocking(); 

      if (WiFi.status() == WL_CONNECTED) {
        connectMqttNonBlocking();
        if (mqttClient.connected()) {
          snprintf(jsonBuffer, sizeof(jsonBuffer),
                   "{\"clusterId\":\"%s\",\"damId\":\"%s\",\"freq\":%.2f,\"amp\":%.2f,\"waterLevel\":%.2f,\"moisture\":%.1f}",
                   clusterId,
                   damId,
                   safeDouble(receivedData.freq), 
                   safeDouble(receivedData.amp), 
                   safeFloat(receivedData.waterLevel), 
                   safeFloat(receivedData.moisturePercent));

          bool success = mqttClient.publish(mqttTopic, jsonBuffer);
          if (success) {
            Serial.printf("[Core 0] MQTT Published [%s]: %s\n", clusterId, jsonBuffer);
          } else {
            Serial.println("[Core 0] MQTT Publish Failed");
          }
        } else {
          Serial.println("[Core 0] MQTT not connected. Packet skipped.");
        }
      } else {
        Serial.println("[Core 0] WiFi Disconnected. Packet skipped.");
      }
    } 
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ================= KHỞI TẠO HỆ THỐNG =================
void setup() {
  Serial.begin(115200);
  Serial.printf("\n[System] Sensor Cluster: %s | Dam: %s\n", clusterId, damId);
  
  Wire.begin(21, 22);
  Wire.setClock(400000); 

  mpu.initialize();
  if (!mpu.testConnection()) {
    Serial.println("MPU6050 error");
  } else {
    int16_t dummy_ax, dummy_ay, dummy_az;
    for (int i = 0; i < 10; i++) {
      mpu.getAcceleration(&dummy_ax, &dummy_ay, &dummy_az);
      ax_f = dummy_ax; ay_f = dummy_ay; az_f = dummy_az;
      delay(10);
    }
  }

  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  pinMode(MOISTURE_POWER, OUTPUT);
  digitalWrite(MOISTURE_POWER, LOW);

  WiFi.begin(ssid, password);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 15) {
    delay(500);
    Serial.print(".");
    retry++;
  }
  
  mqttClient.setServer(mqttServer, mqttPort);
  
  sensorQueue = xQueueCreate(5, sizeof(SensorData));
  if (sensorQueue == NULL) {
    Serial.println("FreeRTOS Queue Init Error!");
    while(1); 
  }

  xTaskCreatePinnedToCore(TaskVibration, "TaskVibration", 8192, NULL, 3, NULL, 1);
  xTaskCreatePinnedToCore(TaskEnvironment, "TaskEnvironment", 4096, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(TaskNetwork, "TaskNetwork", 4096, NULL, 1, NULL, 0);
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}
