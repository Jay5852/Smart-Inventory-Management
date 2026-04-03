#pragma once

#include "hal_config.h"
#include <Preferences.h>
#include <WiFi.h>

constexpr uint8_t MAX_WIFI_PROFILES = 5;

struct WifiProfile {
  String ssid;
  String password;
};

void loadWifiProfiles(Preferences &prefs, WifiProfile profiles[], uint8_t &count);
void saveWifiProfiles(Preferences &prefs, const WifiProfile profiles[],
                      uint8_t count);
void clearWifiProfiles(Preferences &prefs);
bool parseWifiProfilesResponse(const String &response, WifiProfile profiles[],
                               uint8_t &count);
bool connectToSavedWifi(const WifiProfile profiles[], uint8_t count);
