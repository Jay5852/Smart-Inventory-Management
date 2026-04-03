#include "hal_buzzer.h"

void initBuzzer() {
  pinMode(BUZZER_PIN, OUTPUT);
}

void beep(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
  }
}
