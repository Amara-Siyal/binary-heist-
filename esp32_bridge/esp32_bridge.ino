// ESP32 / Arduino bridge: reads the DLD circuit outputs and prints one JSON line per update.
// The real logic (FSM, counters, 74LS85 comparator) lives in hardware; this only reports it.
// Wiring (change to match your board):
const int STATE_PINS[3] = {25, 26, 27};  // FSM state bits Q2 Q1 Q0 from flip-flops
const int CMP_PIN       = 14;            // 74LS85 A=B output
const int LIFE_PINS[3]  = {32, 33, 34};  // life LEDs (active high)
const int BIT_PINS[4]   = {16, 17, 18, 19}; // code register Q3..Q0

void setup() {
  Serial.begin(115200);
  // pull-downs stop floating inputs from giving random readings (GPIO 34/35 have no internal pull: add 10k resistors)
  for (int p : STATE_PINS) pinMode(p, INPUT_PULLDOWN);
  for (int p : LIFE_PINS)  pinMode(p, INPUT_PULLDOWN);
  for (int p : BIT_PINS)   pinMode(p, INPUT_PULLDOWN);
  pinMode(CMP_PIN, INPUT_PULLDOWN);
}

String last = "";
String targetCode = "";      // set by CODE:xxxx from the backend
int startSecs = 0, startLives = 0;  // set by START:secs,lives
unsigned long lastSend = 0;

void loop() {
  int st = 0;
  for (int i = 0; i < 3; i++) st = (st << 1) | digitalRead(STATE_PINS[i]);
  int lives = 0;
  for (int p : LIFE_PINS) lives += digitalRead(p);
  String bits = "";
  for (int p : BIT_PINS) bits += digitalRead(p) ? '1' : '0';
  int cmp = digitalRead(CMP_PIN);

  String json = "{\"state\":\"S" + String(st) + "\",\"lives\":" + lives +
                ",\"bits\":\"" + bits + "\",\"cmp\":" + cmp + "}";
  // send on change, plus a heartbeat every second
  if (json != last || millis() - lastSend > 1000) {
    Serial.println(json);
    last = json; lastSend = millis();
  }

  // Commands from the backend: "CODE:1011" and "START:300,3"
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.startsWith("CODE:")) {
      targetCode = cmd.substring(5);
      // TODO: drive your code-register load lines from targetCode
      Serial.println("{\"ack\":\"CODE\"}");
    } else if (cmd.startsWith("START:")) {
      int comma = cmd.indexOf(',');
      startSecs  = cmd.substring(6, comma).toInt();
      startLives = cmd.substring(comma + 1).toInt();
      // TODO: preset your timer/life counters from startSecs / startLives
      Serial.println("{\"ack\":\"START\"}");
    }
  }
  delay(20);
}
