#define TINY_GSM_MODEM_SIM800

#include <Arduino.h>
#include <ArduinoHttpClient.h>
#include <TinyGPSPlus.h>
#include <TinyGsmClient.h>
#include <WiFi.h>

// --- Tracking Configuration ---
String TRACKER_ID = "COMP-ROUTER-001";
const int UPDATE_INTERVAL_MS = 15000;

// --- Networking Credentials ---
const char *ssid = "AVI";
const char *password = "12345678";
const char apn[] = "internet"; // Standard APN
const char gprsUser[] = "";
const char gprsPass[] = "";

// --- Server API Endpoint ---
const char *serverHost = "10.93.23.163"; // Your laptop's IP
const int serverPort = 3000;
const char *serverPath = "/api/tracking";

// --- Hardware Serial Definitions ---
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
const int GPS_RX_PIN = 16;
const int GPS_TX_PIN = 17;

HardwareSerial gsmSerial(1);
const int GSM_RX_PIN = 14;
const int GSM_TX_PIN = 15;
TinyGsm modem(gsmSerial);

unsigned long lastSendTime = 0;

void setup() {
  Serial.begin(115200);

  // Initialize GPS
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Initialize SIM800L
  gsmSerial.begin(9600, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);

  Serial.println("\n==================================");
  Serial.println("DUAL-MODE GPS TRACKER STARTED");
  Serial.println("==================================");

  // Connect to Wi-Fi initially
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 10) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[Wi-Fi] Not detected. Will fallback to GSM.");
  }
}

void loop() {
  // 1. Process GPS Data Continuously
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // 2. Transmit Location Data at Intervals
  if (millis() - lastSendTime > UPDATE_INTERVAL_MS) {
    lastSendTime = millis();

    if (gps.location.isValid()) {
      float rawLat = gps.location.lat();
      float rawLng = gps.location.lng();
      float hdop = gps.hdop.hdop();

      // [PHASE 2] GPS PRECISION FILTERING
      if (hdop > 2.0) {
        Serial.printf("❌ High GPS Error (HDOP: %.2f) - Ignoring reading\n",
                      hdop);
        return;
      }

      // Exponential Moving Average (EMA)
      static float fLat = 0, fLng = 0;
      const float alpha = 0.4;
      if (fLat == 0) {
        fLat = rawLat;
        fLng = rawLng;
      } else {
        fLat = (alpha * rawLat) + ((1.0 - alpha) * fLat);
        fLng = (alpha * rawLng) + ((1.0 - alpha) * fLng);
      }

      Serial.printf("Filtered GPS: %f, %f (HDOP: %.2f)\n", fLat, fLng, hdop);

      String payload = "{\"trackerId\":\"" + TRACKER_ID +
                       "\",\"lat\":" + String(fLat, 6) +
                       ",\"lng\":" + String(fLng, 6) + "}";

      // Attempt Wi-Fi First
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("[Wi-Fi] Sending data over Wi-Fi...");
        WiFiClient wifiClient;
        HttpClient http(wifiClient, serverHost, serverPort);

        http.beginRequest();
        http.post(serverPath);
        http.sendHeader("Content-Type", "application/json");
        http.sendHeader("Content-Length", payload.length());
        http.beginBody();
        http.print(payload);
        http.endRequest();

        int statusCode = http.responseStatusCode();
        Serial.printf("[Wi-Fi] Response Code: %d\n", statusCode);
      }
      // Fallback to Cellular GPRS
      else {
        Serial.println(
            "[Wi-Fi] Disconnected/Out of Range. Switching to GSM/GPRS...");

        if (!modem.testAT()) {
          Serial.println(
              "[GSM] Failed to communicate with SIM800L. Retrying...");
          modem.restart();
          return;
        }

        if (!modem.isNetworkConnected()) {
          Serial.println("[GSM] Waiting for cellular network...");
          if (!modem.waitForNetwork(60000L)) {
            Serial.println("[GSM] Network fetch failed.");
            return;
          }
        }

        if (!modem.isGprsConnected()) {
          Serial.println("[GSM] Connecting to GPRS Internet...");
          if (!modem.gprsConnect(apn, gprsUser, gprsPass)) {
            Serial.println("[GSM] GPRS Connection Failed.");
            return;
          }
        }

        Serial.println("[GSM] GPRS Connected. Sending data...");
        TinyGsmClient gsmClient(modem);
        HttpClient http(gsmClient, serverHost, serverPort);

        http.beginRequest();
        http.post(serverPath);
        http.sendHeader("Content-Type", "application/json");
        http.sendHeader("Content-Length", payload.length());
        http.beginBody();
        http.print(payload);
        http.endRequest();

        int statusCode = http.responseStatusCode();
        Serial.printf("[GSM] Response Code: %d\n", statusCode);
        http.stop();
      }

    } else {
      Serial.println("Waiting for GPS satellite lock...");
    }
  }
}
