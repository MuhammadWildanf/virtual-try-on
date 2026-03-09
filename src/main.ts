import { bootstrapCameraKit, CameraKit, CameraKitSession, createMediaStreamSource, Transform2D } from "@snap/camera-kit";
import type { Lens } from "@snap/camera-kit";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// ============================================================
// KONFIGURASI
// ============================================================
// staging 
// const API_TOKEN = "eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzcyNjMzMDg5LCJzdWIiOiJmYWY3YTYwZS02NjQ1LTQ3NzYtYWRmNi0xMDRlMmRhOWQyOWV-U1RBR0lOR34zZGUyZWU2Ni03M2UxLTQ4MjEtODAxMC03Mzc5ZDVjM2M5MzIifQ.x3GUEUExf5HRLKpg3WHbWVAHUgx9ttpfmLuoJH_egzo";
// production
const API_TOKEN = "eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzcyNjMzMDkwLCJzdWIiOiJmYWY3YTYwZS02NjQ1LTQ3NzYtYWRmNi0xMDRlMmRhOWQyOWV-UFJPRFVDVElPTn5jY2I0Zjk0Yy05MWY5LTRiYjMtYmE0NC1mNzA2MDBkNGNlZmIifQ.l3tuwLGIv1YYmkvCXl4YxS8VyPLDp36eMPFyEbYGQd0";


// Group ID — ImajiwaLAB Lenses (Camera Kit Staging sudah Enabled!)
const GROUP_ID = "fd3aaa28-c325-4f1f-a7f3-fa7891a89789";

// ─── Gesture config ───
const SWIPE_THRESHOLD = 0.12;
const SWIPE_COOLDOWN_MS = 1200;
const THUMBSUP_HOLD_MS = 1000; // tahan 1 detik → lepas lens

// ─── State ───
let cameraKit: CameraKit;
let session: CameraKitSession;
let lenses: Lens[] = [];      // hasil fetch dari Lens Group
let activeIndex = -1;          // index aktif di array lenses
let videoEl: HTMLVideoElement;

// Gesture tracking
let lastSwipeTime = 0;
let handXHistory: number[] = [];
let thumbsUpStartTime = 0;
let thumbsUpActive = false;
let lastGestureHintTime = 0;

// ─── DOM helpers ───
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function showLoading(show: boolean) {
  const el = $("loading");
  show ? el.classList.remove("hidden") : el.classList.add("hidden");
}

function setStatus(text: string, active = false) {
  const badge = $("status-badge");
  badge.textContent = text;
  active ? badge.classList.add("active") : badge.classList.remove("active");
}

function showLensIndicator(name: string) {
  const indicator = $("lens-indicator");
  $("lens-indicator-text").textContent = `${name} diterapkan`;
  indicator.classList.add("visible");
  setTimeout(() => indicator.classList.remove("visible"), 2500);
}

function showGestureHint(text: string) {
  const now = performance.now();
  if (now - lastGestureHintTime < 800) return;
  lastGestureHintTime = now;

  const el = $("swipe-hint");
  el.textContent = text;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 900);
}

function showError(msg = "Gagal memuat. Coba refresh halaman.") {
  const toast = $("error-toast");
  toast.textContent = `⚠️ ${msg}`;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 4000);
}

function updateGestureUI(icon: string, label: string) {
  const dot = document.querySelector(".gesture-dot") as HTMLElement;
  const span = document.querySelector("#gesture-status span:last-child") as HTMLElement;
  if (dot) dot.textContent = icon;
  if (span) span.textContent = label;
}

// ─── Render gallery dari lenses yang di-fetch ───
function renderGallery() {
  const scroll = $("clothes-scroll");
  scroll.innerHTML = "";

  if (lenses.length === 0) {
    scroll.innerHTML = `<p style="color:rgba(255,255,255,0.4);font-size:12px;padding:8px;">Belum ada lens tersedia</p>`;
    return;
  }

  lenses.forEach((lens, idx) => {
    const card = document.createElement("div");
    card.className = "clothes-card";
    card.id = `card-${lens.id}`;
    if (idx === activeIndex) card.classList.add("active");

    // Pakai icon/thumbnail dari metadata lens jika ada
    const icon = (lens as any).icons?.[0]?.uri || null;

    card.innerHTML = `
      <div class="clothes-thumb">
        ${icon ? `<img src="${icon}" alt="${lens.name}" />` : "🕶️"}
      </div>
      <span class="clothes-name">${lens.name || `Lens ${idx + 1}`}</span>
    `;
    card.addEventListener("click", () => applyLensByIndex(idx));
    scroll.appendChild(card);
  });

  // Update label count
  const label = $("panel-label");
  if (label) label.textContent = `${lenses.length} Outfit Tersedia`;
}

// ─── Apply lens by index ───
async function applyLensByIndex(idx: number) {
  if (idx < 0 || idx >= lenses.length) return;
  if (idx === activeIndex) return;

  const lens = lenses[idx];

  document.querySelectorAll(".clothes-card").forEach((c) =>
    c.classList.remove("active", "loading-lens")
  );

  const card = $(`card-${lens.id}`);
  card?.classList.add("loading-lens");

  try {
    await session.applyLens(lens);

    card?.classList.remove("loading-lens");
    card?.classList.add("active");
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

    activeIndex = idx;
    showLensIndicator(lens.name || `Lens ${idx + 1}`);
  } catch (err) {
    card?.classList.remove("loading-lens");
    console.error("Gagal apply lens:", err);
    showError(`Gagal memuat "${lens.name}"`);
  }
}

// ─── Remove lens ───
async function removeLens() {
  await session.removeLens();
  activeIndex = -1;
  document.querySelectorAll(".clothes-card").forEach((c) =>
    c.classList.remove("active", "loading-lens")
  );
}
(window as any).removeLens = removeLens;

// ─── Gesture: next / prev outfit ───
function nextOutfit() {
  if (lenses.length === 0) return;
  const next = activeIndex < lenses.length - 1 ? activeIndex + 1 : 0;
  applyLensByIndex(next);
}

function prevOutfit() {
  if (lenses.length === 0) return;
  const prev = activeIndex > 0 ? activeIndex - 1 : lenses.length - 1;
  applyLensByIndex(prev);
}

// ─── Deteksi thumbs up ───
function isThumbsUp(landmarks: { x: number; y: number; z: number }[]): boolean {
  // Ibu jari teracung ke atas: tip (4) lebih tinggi dari IP (3)
  const thumbUp = landmarks[4].y < landmarks[3].y - 0.05;
  // Jari lain mengepal: tip lebih rendah dari PIP
  const indexCurled = landmarks[8].y > landmarks[6].y;
  const middleCurled = landmarks[12].y > landmarks[10].y;
  const ringCurled = landmarks[16].y > landmarks[14].y;
  return thumbUp && indexCurled && middleCurled && ringCurled;
}

// ─── MediaPipe Hand Gesture Detection ───
async function initGestureDetection(stream: MediaStream) {
  videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.autoplay = true;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await videoEl.play();

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });

  const gestureEl = $("gesture-status");

  function detectLoop() {
    if (!videoEl || videoEl.readyState < 2) {
      requestAnimationFrame(detectLoop);
      return;
    }

    const now = performance.now();
    const result = handLandmarker.detectForVideo(videoEl, now);

    if (result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      const wristX = landmarks[0].x;

      handXHistory.push(wristX);
      if (handXHistory.length > 12) handXHistory.shift();

      gestureEl.classList.add("detected");

      // ─── Deteksi thumbs up → lepas lens ───
      if (isThumbsUp(landmarks)) {
        if (!thumbsUpActive) {
          thumbsUpActive = true;
          thumbsUpStartTime = now;
          updateGestureUI("👍", "Tahan untuk lepas...");
        } else if (now - thumbsUpStartTime > THUMBSUP_HOLD_MS) {
          thumbsUpActive = false;
          thumbsUpStartTime = 0;
          handXHistory = [];
          removeLens();
          showGestureHint("👍 Lens dilepas");
        }
        requestAnimationFrame(detectLoop);
        return;
      } else {
        if (thumbsUpActive) {
          thumbsUpActive = false;
          updateGestureUI("🖐️", "Tangan terdeteksi");
        }
      }

      // ─── Deteksi swipe → ganti outfit ───
      if (handXHistory.length >= 10) {
        const delta = handXHistory[handXHistory.length - 1] - handXHistory[0];
        const elapsed = now - lastSwipeTime;

        if (Math.abs(delta) > SWIPE_THRESHOLD && elapsed > SWIPE_COOLDOWN_MS) {
          lastSwipeTime = now;
          handXHistory = [];

          // Canvas sudah di-mirror (scaleX -1), delta positif = tangan ke kanan (visual)
          if (delta > 0) {
            showGestureHint("👉 Selanjutnya");
            nextOutfit();
          } else {
            showGestureHint("👈 Sebelumnya");
            prevOutfit();
          }
        }
      }

      updateGestureUI("🖐️", "Tangan terdeteksi");
    } else {
      handXHistory = [];
      thumbsUpActive = false;
      gestureEl.classList.remove("detected");
      updateGestureUI("·", "Gesture");
    }

    requestAnimationFrame(detectLoop);
  }

  detectLoop();
}

// ─── Init ───
(async function init() {
  try {
    setStatus("Memuat...");

    cameraKit = await bootstrapCameraKit({ apiToken: API_TOKEN });
    const canvas = $<HTMLCanvasElement>("canvas");
    session = await cameraKit.createSession({ liveRenderTarget: canvas });

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });

    const source = createMediaStreamSource(mediaStream, {
      transform: Transform2D.MirrorX, // Natively mirror inside Camera Kit
    });

    await session.setSource(source);
    await session.play();

    showLoading(false);
    setStatus("Kamera Aktif", true);

    // ─── Fetch semua lens dari Group ───
    try {
      console.log("🔍 Mencoba loadLensGroups dengan GROUP_ID:", GROUP_ID);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await (cameraKit.lensRepository as any).loadLensGroups([GROUP_ID]);
      console.log("📦 loadLensGroups raw result:", raw);

      if (raw?.errors?.length > 0) {
        console.error("⚠️ loadLensGroups errors:", raw.errors);
      }
      if (Array.isArray(raw)) {
        lenses = raw.flatMap((g: any) => g.lenses ?? []);
      } else if (raw && Array.isArray(raw.lenses)) {
        lenses = raw.lenses;
      } else if (raw && typeof raw === "object") {
        const firstArray = Object.values(raw).find(Array.isArray) as any[];
        lenses = firstArray ?? [];
      }

      console.log(`✅ ${lenses.length} lens dimuat dari grup`);
    } catch (err: any) {
      console.error("❌ Gagal memuat lens dari grup:", err?.message ?? err);
      console.error("❌ Full error:", err);
      lenses = [];
    }

    renderGallery();

    // Inisialisasi gesture detection di background
    initGestureDetection(mediaStream).catch((err) => {
      console.warn("Gesture detection gagal (tetap berjalan tanpa gesture):", err);
    });

  } catch (err) {
    console.error("Init error:", err);
    showLoading(false);
    setStatus("Error");
    showError("Kamera gagal diakses. Izinkan akses kamera di browser.");
  }
})();
