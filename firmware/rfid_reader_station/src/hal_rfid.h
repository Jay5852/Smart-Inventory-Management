#pragma once

#include "hal_config.h"
#include <MFRC522.h>

extern MFRC522 mfrc522;

void initRFID();
String readRFIDCard();
