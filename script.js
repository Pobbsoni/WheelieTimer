const SENSITIVITY = {
  easy: { start: 15, stop: 10 },
  normal: { start: 18, stop: 12 },
  hard: { start: 22, stop: 15 }
};
const START_DELAY = 150;
const STOP_DELAY = 1000;
const ANGLE_SMOOTHING = 0.2;
const ANGLE_DISPLAY_INTERVAL = 200;

const defaults = {
  sensitivity: "normal",
  vibration: true,
  sound: false,
  darkMode: true,
  accelStart: 1,
  speedLimit: 25,
  units: "kmh",
  accent: "#7dff48"
};
const settings = { ...defaults, ...JSON.parse(localStorage.getItem("wheelieSettings") || "{}") };

let calibrated = false;
let riding = false;
let baselineAngle = 0;
let currentAngle = 0;
let filteredRelativeAngle = 0;
let hasFilteredAngle = false;
let lastAngleDisplayUpdate = 0;
let wheelieStart = 0;
let startCandidateSince = null;
let stopCandidateSince = null;
let currentSpeed = 0;
let previousSpeed = 0;
let speedWarningActive = false;

let best = Number(localStorage.getItem("wheelieBest")) || 0;
let last = Number(localStorage.getItem("wheelieLast")) || 0;
let maxSpeed = Number(localStorage.getItem("maxSpeed")) || 0;

let acceleration = { armed: false, running: false, startTime: 0, target: 20, elapsed: 0 };
let ride = { active: false, startedAt: 0, topSpeed: 0, wheelies: 0, longest: 0, timer: null };

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const timerEls = $$(".home-timer, .wheelie-timer");
const angleEls = $$(".angle-value");
const speedEls = $$(".home-speed, .wheelie-speed, .accel-speed-value");
const rideSpeedEl = $(".ride-speed-value");
const speedScreenEl = $(".speed-screen-value");

function saveSettings() {
  localStorage.setItem("wheelieSettings", JSON.stringify(settings));
}

function convertSpeed(kmh) {
  return settings.units === "mph" ? kmh * 0.621371 : kmh;
}

function speedUnit() {
  return settings.units === "mph" ? "mph" : "km/h";
}

function displaySpeed(kmh, decimals = 0) {
  return `${convertSpeed(kmh).toFixed(decimals)} ${speedUnit()}`;
}

function updateStats() {
  $$(".best-value").forEach(el => el.textContent = best.toFixed(2));
  $$(".last-value").forEach(el => el.textContent = last.toFixed(2));
  $$(".max-speed-value").forEach(el => el.textContent = displaySpeed(maxSpeed));
}

function updateSettingsUI() {
  document.body.classList.toggle("dark", settings.darkMode);
  document.documentElement.style.setProperty("--accent", settings.accent);
  $("#sensitivity").value = settings.sensitivity;
  $("#vibration").checked = settings.vibration;
  $("#sound").checked = settings.sound;
  $("#darkMode").checked = settings.darkMode;
  $("#accelStart").value = settings.accelStart;
  $("#speedLimit").value = settings.speedLimit;
  $("#units").value = settings.units;
  $("#accent").value = settings.accent;
  $("#accelStartValue").textContent = `${Number(settings.accelStart).toFixed(1)} km/h`;
  $("#speedLimitValue").textContent = displaySpeed(settings.speedLimit);
  $("#speedLimitReadout").textContent = displaySpeed(settings.speedLimit);
  $$(".speed-unit").forEach(el => el.textContent = speedUnit().toUpperCase());
  updateSpeedUI();
  updateStats();
}

function showScreen(id) {
  $$(".screen").forEach(screen => screen.classList.toggle("active", screen.id === id));
  window.scrollTo(0, 0);
}

function notify(kind) {
  if (settings.vibration && navigator.vibrate) navigator.vibrate(kind === "end" ? [70, 50, 70] : 50);
  if (!settings.sound) return;
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = kind === "end" ? 750 : 500;
    gain.gain.setValueAtTime(0.05, context.currentTime);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
  } catch (_) { /* Ljud är frivilligt och stöds inte i alla webbläsare. */ }
}

async function calibrate() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== "granted") throw new Error("permission denied");
    }
    baselineAngle = currentAngle;
    filteredRelativeAngle = 0;
    hasFilteredAngle = false;
    startCandidateSince = null;
    stopCandidateSince = null;
    riding = false;
    calibrated = true;
    timerEls.forEach(el => el.textContent = "0.00");
    $$(".calibrate-button").forEach(button => button.textContent = "KALIBRERAD");
  } catch (error) {
    console.error("Sensor permission error:", error);
    alert("Tillåt rörelsesensor för att använda Wheelie Timer.");
  }
}

function finishWheelie(now) {
  const finalTime = (now - wheelieStart) / 1000;
  timerEls.forEach(el => el.textContent = finalTime.toFixed(2));
  last = finalTime;
  if (finalTime > best) best = finalTime;
  localStorage.setItem("wheelieBest", best);
  localStorage.setItem("wheelieLast", last);
  updateStats();
  if (ride.active) ride.longest = Math.max(ride.longest, finalTime);
  riding = false;
  stopCandidateSince = null;
  notify("end");
}

function handleMotion(event) {
  const accelerationData = event.accelerationIncludingGravity;
  if (!accelerationData) return;
  const x = accelerationData.x || 0;
  const y = accelerationData.y || 0;
  const z = accelerationData.z || 0;
  currentAngle = Math.atan2(y, Math.sqrt(x * x + z * z)) * (180 / Math.PI);
  const relativeAngle = currentAngle - baselineAngle;
  if (!hasFilteredAngle) {
    filteredRelativeAngle = relativeAngle;
    hasFilteredAngle = true;
  } else {
    filteredRelativeAngle += (relativeAngle - filteredRelativeAngle) * ANGLE_SMOOTHING;
  }
  const now = performance.now();
  if (now - lastAngleDisplayUpdate >= ANGLE_DISPLAY_INTERVAL) {
    angleEls.forEach(el => el.textContent = `${Math.abs(filteredRelativeAngle).toFixed(1)}°`);
    lastAngleDisplayUpdate = now;
  }
  if (!calibrated) return;
  const sensitivity = SENSITIVITY[settings.sensitivity];
  if (!riding) {
    if (filteredRelativeAngle < -sensitivity.start) {
      startCandidateSince ??= now;
      if (now - startCandidateSince >= START_DELAY) {
        riding = true;
        wheelieStart = now;
        startCandidateSince = null;
        timerEls.forEach(el => el.textContent = "0.00");
        if (ride.active) ride.wheelies += 1;
        notify("start");
      }
    } else startCandidateSince = null;
    return;
  }
  const elapsed = (now - wheelieStart) / 1000;
  timerEls.forEach(el => el.textContent = elapsed.toFixed(2));
  if (filteredRelativeAngle >= -sensitivity.stop) {
    stopCandidateSince ??= now;
    if (now - stopCandidateSince >= STOP_DELAY) finishWheelie(now);
  } else stopCandidateSince = null;
}

function updateSpeedUI() {
  speedEls.forEach(el => el.textContent = displaySpeed(currentSpeed));
  speedScreenEl.textContent = convertSpeed(currentSpeed).toFixed(0);
  rideSpeedEl.textContent = convertSpeed(currentSpeed).toFixed(0);
  $("#targetSpeedValue").textContent = displaySpeed(acceleration.target);
}

function updateAcceleration(now) {
  if (acceleration.armed && !acceleration.running && currentSpeed >= Number(settings.accelStart)) {
    acceleration.running = true;
    acceleration.startTime = now;
    $("#accelStatus").textContent = "MÄTER...";
  }
  if (!acceleration.running) return;
  acceleration.elapsed = (now - acceleration.startTime) / 1000;
  $("#accelTimer").textContent = acceleration.elapsed.toFixed(2);
  if (currentSpeed >= acceleration.target) {
    acceleration.armed = false;
    acceleration.running = false;
    $("#accelStatus").textContent = "KLAR";
    $("#accelButton").textContent = "KÖR IGEN";
    notify("end");
  }
}

function updateRideUI() {
  $("#rideTopSpeed").textContent = displaySpeed(ride.topSpeed);
  $("#rideWheelies").textContent = ride.wheelies;
  $("#rideLongest").textContent = `${ride.longest.toFixed(2)} s`;
}

function updateRideTime() {
  if (!ride.active) return;
  const seconds = Math.floor((Date.now() - ride.startedAt) / 1000);
  $("#rideTime").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function startRide() {
  ride = { active: true, startedAt: Date.now(), topSpeed: currentSpeed, wheelies: 0, longest: 0, timer: null };
  $("#rideTitle").textContent = "KÖRNING PÅGÅR";
  $("#rideButton").textContent = "AVSLUTA PASS";
  $("#speedRideButton").textContent = "AVSLUTA PASS";
  $("#rideSummary").classList.add("hidden");
  $("#rideLive").classList.remove("hidden");
  ride.timer = setInterval(updateRideTime, 500);
  updateRideUI();
}

function endRide() {
  ride.active = false;
  clearInterval(ride.timer);
  const seconds = Math.floor((Date.now() - ride.startedAt) / 1000);
  const duration = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("#summaryTime").textContent = duration;
  $("#summaryTop").textContent = displaySpeed(ride.topSpeed);
  $("#summaryWheelies").textContent = ride.wheelies;
  $("#summaryLongest").textContent = `${ride.longest.toFixed(2)} s`;
  $("#rideTitle").textContent = "KÖRNING KLAR";
  $("#rideLive").classList.add("hidden");
  $("#rideSummary").classList.remove("hidden");
  $("#speedRideButton").textContent = "STARTA PASS";
}

function handleSpeed(speedKmh) {
  const now = performance.now();
  previousSpeed = currentSpeed;
  currentSpeed = speedKmh;
  if (currentSpeed > maxSpeed) {
    maxSpeed = currentSpeed;
    localStorage.setItem("maxSpeed", maxSpeed);
    updateStats();
  }
  if (ride.active) {
    ride.topSpeed = Math.max(ride.topSpeed, currentSpeed);
    updateRideUI();
  }
  if (currentSpeed >= settings.speedLimit && previousSpeed < settings.speedLimit && !speedWarningActive) {
    speedWarningActive = true;
    notify("end");
  }
  if (currentSpeed < settings.speedLimit) speedWarningActive = false;
  updateSpeedUI();
  updateAcceleration(now);
}

function startGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(position => {
    if (typeof position.coords.speed === "number" && position.coords.speed >= 0) handleSpeed(position.coords.speed * 3.6);
  }, error => console.log("GPS error:", error.message), { enableHighAccuracy: true, maximumAge: 500, timeout: 5000 });
}

$$('[data-screen]').forEach(button => button.addEventListener("click", () => showScreen(button.dataset.screen)));
$$(".calibrate-button").forEach(button => button.addEventListener("click", calibrate));
$("#targetSpeed").addEventListener("input", event => { acceleration.target = Number(event.target.value); updateSpeedUI(); });
$("#accelButton").addEventListener("click", () => {
  if (acceleration.armed || acceleration.running) {
    acceleration.armed = false;
    acceleration.running = false;
    $("#accelStatus").textContent = "REDO";
    $("#accelButton").textContent = "STARTA TEST";
    return;
  }
  acceleration.armed = true; acceleration.running = false; acceleration.elapsed = 0;
  $("#accelTimer").textContent = "0.00";
  $("#accelStatus").textContent = "VÄNTAR PÅ START";
  $("#accelButton").textContent = "AVBRYT";
});
$("#rideButton").addEventListener("click", () => ride.active ? endRide() : startRide());
$("#speedRideButton").addEventListener("click", () => ride.active ? endRide() : startRide());
$("#newRideButton").addEventListener("click", startRide);

$("#sensitivity").addEventListener("change", event => { settings.sensitivity = event.target.value; saveSettings(); });
$("#vibration").addEventListener("change", event => { settings.vibration = event.target.checked; saveSettings(); });
$("#sound").addEventListener("change", event => { settings.sound = event.target.checked; saveSettings(); });
$("#darkMode").addEventListener("change", event => { settings.darkMode = event.target.checked; saveSettings(); updateSettingsUI(); });
$("#accelStart").addEventListener("input", event => { settings.accelStart = Number(event.target.value); saveSettings(); updateSettingsUI(); });
$("#speedLimit").addEventListener("input", event => { settings.speedLimit = Number(event.target.value); saveSettings(); updateSettingsUI(); });
$("#units").addEventListener("change", event => { settings.units = event.target.value; saveSettings(); updateSettingsUI(); });
$("#accent").addEventListener("change", event => { settings.accent = event.target.value; saveSettings(); updateSettingsUI(); });
$("#clearWheelie").addEventListener("click", () => { if (confirm("Radera bästa och senaste wheelie?")) { best = 0; last = 0; localStorage.removeItem("wheelieBest"); localStorage.removeItem("wheelieLast"); updateStats(); } });
$("#clearSpeed").addEventListener("click", () => { if (confirm("Radera topphastigheten?")) { maxSpeed = 0; localStorage.removeItem("maxSpeed"); updateStats(); } });
$("#resetSettings").addEventListener("click", () => { if (confirm("Återställ alla inställningar?")) { Object.assign(settings, defaults); saveSettings(); updateSettingsUI(); } });

window.addEventListener("devicemotion", handleMotion, { passive: true });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(error => console.log("Service Worker error:", error)));
acceleration.target = Number($("#targetSpeed").value);
updateSettingsUI();
startGPS();
