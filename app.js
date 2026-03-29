/* ═══════════════════════════════════════════════════
   TURFWAR — app.js
   All game logic: auth, GPS tracking, map, leaderboard,
   challenges, profile, territory system
═══════════════════════════════════════════════════ */

/* ── Wait for Firebase to load ───────────────────── */
let _fb = null;
function fb() { return window._firebase; }

// ── Toast ─────────────────────────────────────────
function showToast(msg, duration = 2500) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

/* ════════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════════ */
let currentUser = null;
let userProfile = null;

function initAuth() {
  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`auth-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Email login
  document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    if (!email || !pass) return setAuthError('Please fill in all fields.');
    try {
      await fb().signInWithEmailAndPassword(fb().auth, email, pass);
    } catch (e) { setAuthError(friendlyAuthError(e.code)); }
  });

  // Email sign up
  document.getElementById('btn-signup').addEventListener('click', async () => {
    const name  = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const pass  = document.getElementById('signup-password').value;
    if (!name || !email || !pass) return setAuthError('Please fill in all fields.');
    if (pass.length < 6) return setAuthError('Password must be at least 6 characters.');
    try {
      const cred = await fb().createUserWithEmailAndPassword(fb().auth, email, pass);
      await fb().updateProfile(cred.user, { displayName: name });
      await createUserProfile(cred.user, name);
    } catch (e) { setAuthError(friendlyAuthError(e.code)); }
  });

  // Google
  [document.getElementById('btn-google-login'), document.getElementById('btn-google-signup')]
    .forEach(btn => btn.addEventListener('click', async () => {
      try {
        const provider = new fb().GoogleAuthProvider();
        const cred = await fb().signInWithPopup(fb().auth, provider);
        await createUserProfileIfNew(cred.user);
      } catch (e) { setAuthError(friendlyAuthError(e.code)); }
    }));

  // Sign out
  document.getElementById('btn-signout').addEventListener('click', async () => {
    await fb().signOut(fb().auth);
  });

  // Auth state observer
  fb().onAuthStateChanged(fb().auth, async (user) => {
    if (user) {
      currentUser = user;
      await loadUserProfile(user);
      showApp();
    } else {
      currentUser = null;
      userProfile = null;
      showAuth();
    }
  });
}

function setAuthError(msg) {
  document.getElementById('auth-error').textContent = msg;
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':     'No account found with that email.',
    'auth/wrong-password':     'Incorrect password.',
    'auth/email-already-in-use': 'That email is already registered.',
    'auth/invalid-email':      'Please enter a valid email.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/network-request-failed': 'Network error. Please try again.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

async function createUserProfile(user, displayName) {
  const { db, doc, setDoc } = fb();
  await setDoc(doc(db, 'users', user.uid), {
    displayName: displayName || user.displayName || 'Runner',
    email: user.email,
    points: 0,
    totalRuns: 0,
    totalKm: 0,
    turfCount: 0,
    createdAt: fb().serverTimestamp(),
  });
}

async function createUserProfileIfNew(user) {
  const { db, doc, getDoc, setDoc } = fb();
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) await createUserProfile(user, user.displayName);
}

async function loadUserProfile(user) {
  const { db, doc, getDoc } = fb();
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (snap.exists()) {
    userProfile = { uid: user.uid, ...snap.data() };
  } else {
    await createUserProfile(user);
    userProfile = { uid: user.uid, displayName: user.displayName || 'Runner',
      points: 0, totalRuns: 0, totalKm: 0, turfCount: 0 };
  }
  updateUI();
}

function updateUI() {
  if (!userProfile) return;
  const initials = (userProfile.displayName || 'R')[0].toUpperCase();
  document.getElementById('topbar-avatar').textContent = initials;
  document.getElementById('topbar-points').textContent = `${userProfile.points.toLocaleString()} pts`;
  document.getElementById('profile-avatar-lg').textContent = initials;
  document.getElementById('profile-name').textContent = userProfile.displayName || 'Runner';
  document.getElementById('profile-email').textContent = userProfile.email || '';
  document.getElementById('stat-points').textContent = userProfile.points.toLocaleString();
  document.getElementById('stat-runs').textContent = userProfile.totalRuns || 0;
  document.getElementById('stat-km').textContent = (userProfile.totalKm || 0).toFixed(1);
  document.getElementById('stat-turf').textContent = userProfile.turfCount || 0;
}

function showApp()  {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
  initMap();
  initLeaderboard();
  initChallenges();
  loadRecentRuns();
}

function showAuth() {
  document.getElementById('app-screen').classList.remove('active');
  document.getElementById('auth-screen').classList.add('active');
}

/* ════════════════════════════════════════════════════
   TABS
════════════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'leaderboard') loadLeaderboard();
      if (tab === 'home' && map) setTimeout(() => map.invalidateSize(), 50);
    });
  });
}

/* ════════════════════════════════════════════════════
   MAP & GPS
════════════════════════════════════════════════════ */
let map = null;
let mapInitialised = false;
let userMarker = null;
let runPolyline = null;
let watchId = null;
let isRunning = false;
let runPath = [];   // [{lat, lng}, ...]
let runStartTime = null;
let runTimerInterval = null;
let totalDistance = 0; // metres
let turfPolylines = {}; // uid -> [polyline]

function initMap() {
  if (mapInitialised) return;
  mapInitialised = true;

  map = L.map('map', { zoomControl: true, attributionControl: false });

  // Dark-ish OSM tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '©OpenStreetMap ©CartoDB'
  }).addTo(map);

  // Start at Auckland (fallback)
  map.setView([-36.8509, 174.7645], 15);

  // Try to get user location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      map.setView([lat, lng], 17);
      placeUserMarker(lat, lng);
    }, () => {}, { enableHighAccuracy: true });
  }

  // Load existing turf from Firestore
  loadTurfFromFirestore();

  // Map click → check turf
  map.on('click', onMapClick);

  // Close turf popup
  document.getElementById('turf-popup-close').addEventListener('click', () => {
    document.getElementById('turf-popup').classList.add('hidden');
  });

  // Run button
  document.getElementById('btn-run').addEventListener('click', onRunButtonClick);
}

function placeUserMarker(lat, lng) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:16px;height:16px;border-radius:50%;
      background:var(--neon);
      border:3px solid #000;
      box-shadow:0 0 12px rgba(0,255,135,0.8);
    "></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8]
  });
  if (userMarker) userMarker.setLatLng([lat, lng]);
  else userMarker = L.marker([lat, lng], { icon }).addTo(map);
}

/* ── Run Flow ────────────────────────────────────── */
function onRunButtonClick() {
  if (isRunning) {
    stopRun();
  } else {
    startCountdown();
  }
}

function startCountdown() {
  document.getElementById('countdown-overlay').classList.remove('hidden');
  document.getElementById('btn-run').disabled = true;
  const nums = ['3','2','1','GO!'];
  let i = 0;
  const el = document.getElementById('countdown-number');
  const tick = () => {
    el.textContent = nums[i];
    // Re-trigger animation
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = '';
    i++;
    if (i < nums.length) setTimeout(tick, 900);
    else setTimeout(() => {
      document.getElementById('countdown-overlay').classList.add('hidden');
      document.getElementById('btn-run').disabled = false;
      startRun();
    }, 600);
  };
  tick();
}

function startRun() {
  isRunning = true;
  runPath = [];
  totalDistance = 0;
  runStartTime = Date.now();

  document.getElementById('btn-run').textContent = 'STOP RUN';
  document.getElementById('btn-run').classList.add('running');
  document.getElementById('run-overlay').classList.remove('hidden');

  // Start drawing polyline
  if (runPolyline) { map.removeLayer(runPolyline); }
  runPolyline = L.polyline([], {
    color: '#00FF87', weight: 4, opacity: 0.9,
    dashArray: null
  }).addTo(map);

  // GPS watch
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(onGpsUpdate, onGpsError, {
      enableHighAccuracy: true, maximumAge: 1000, timeout: 10000
    });
  }

  // Timer
  runTimerInterval = setInterval(updateRunStats, 1000);
}

function onGpsUpdate(pos) {
  const { latitude: lat, longitude: lng } = pos.coords;
  placeUserMarker(lat, lng);
  map.panTo([lat, lng]);

  const point = { lat, lng };
  if (runPath.length > 0) {
    const prev = runPath[runPath.length - 1];
    totalDistance += haversine(prev, point);
  }
  runPath.push(point);
  runPolyline.addLatLng([lat, lng]);
}

function onGpsError(err) {
  console.warn('GPS error:', err.message);
  // Simulate movement in demo mode if GPS unavailable
  if (runPath.length === 0 && userMarker) {
    simulateRun();
  }
}

function simulateRun() {
  // Gently move marker for demo purposes when GPS unavailable
  let base = map.getCenter();
  let step = 0;
  const sim = setInterval(() => {
    if (!isRunning) { clearInterval(sim); return; }
    const lat = base.lat + Math.cos(step * 0.3) * 0.0003;
    const lng = base.lng + Math.sin(step * 0.3) * 0.0004;
    step++;
    const point = { lat, lng };
    if (runPath.length > 0) totalDistance += haversine(runPath[runPath.length-1], point);
    runPath.push(point);
    placeUserMarker(lat, lng);
    runPolyline.addLatLng([lat, lng]);
    map.panTo([lat, lng]);
  }, 1500);
}

function updateRunStats() {
  const elapsed = Math.floor((Date.now() - runStartTime) / 1000);
  const km = totalDistance / 1000;
  const hrs = elapsed / 3600;
  const speed = hrs > 0 ? (km / hrs) : 0;

  document.getElementById('run-distance').textContent = km.toFixed(2);
  document.getElementById('run-time').textContent = formatTime(elapsed);
  document.getElementById('run-speed').textContent = speed.toFixed(1);
}

async function stopRun() {
  isRunning = false;
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  clearInterval(runTimerInterval);

  document.getElementById('btn-run').textContent = 'START RUN';
  document.getElementById('btn-run').classList.remove('running');
  document.getElementById('run-overlay').classList.add('hidden');

  const km = totalDistance / 1000;
  if (km < 0.05 || runPath.length < 2) {
    showToast('Run too short — keep going next time!');
    if (runPolyline) { map.removeLayer(runPolyline); runPolyline = null; }
    runPath = [];
    return;
  }

  // Save turf + run to Firestore
  const pts = Math.round(km * 100);
  await saveRun(km, pts);
  await claimTurf(pts);

  showToast(`+${pts} pts — Turf claimed! 🏆`);
}

/* ── Turf / Territory ────────────────────────────── */
function getColorForUser(uid) {
  // Deterministic color per user from uid
  const colors = ['#00FF87','#0A84FF','#FF6B35','#FF3B30','#BF5AF2','#FFD60A','#30D158','#64D2FF'];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

async function claimTurf(pts) {
  if (!currentUser || runPath.length < 2) return;
  const { db, collection, addDoc, doc, updateDoc, serverTimestamp } = fb();

  const turfDoc = {
    uid: currentUser.uid,
    displayName: userProfile.displayName,
    path: runPath,
    pts,
    km: totalDistance / 1000,
    claimedAt: serverTimestamp(),
  };

  await addDoc(collection(db, 'turf'), turfDoc);

  // Update user stats
  const newPoints = (userProfile.points || 0) + pts;
  const newRuns   = (userProfile.totalRuns || 0) + 1;
  const newKm     = (userProfile.totalKm || 0) + (totalDistance / 1000);
  const newTurf   = (userProfile.turfCount || 0) + 1;

  await updateDoc(doc(db, 'users', currentUser.uid), {
    points: newPoints, totalRuns: newRuns,
    totalKm: newKm, turfCount: newTurf
  });

  userProfile.points    = newPoints;
  userProfile.totalRuns = newRuns;
  userProfile.totalKm   = newKm;
  userProfile.turfCount = newTurf;
  updateUI();

  // Draw on map
  drawTurfPolyline(currentUser.uid, runPath, userProfile.displayName);
}

function drawTurfPolyline(uid, path, displayName) {
  const color = getColorForUser(uid);
  const latlngs = path.map(p => [p.lat, p.lng]);
  const pl = L.polyline(latlngs, {
    color, weight: 5, opacity: 0.85
  }).addTo(map);

  pl.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    showTurfInfo(uid, displayName, color, latlngs.length);
  });

  if (!turfPolylines[uid]) turfPolylines[uid] = [];
  turfPolylines[uid].push(pl);
}

async function loadTurfFromFirestore() {
  const { db, collection, getDocs, query, orderBy, limit } = fb();
  try {
    const q = query(collection(db, 'turf'), orderBy('claimedAt', 'desc'), limit(200));
    const snap = await getDocs(q);
    snap.forEach(doc => {
      const d = doc.data();
      if (d.path && d.uid) drawTurfPolyline(d.uid, d.path, d.displayName);
    });
  } catch (e) { console.warn('Turf load error:', e); }
}

function onMapClick(e) {
  // Check if clicked near any turf polyline
  // Simple nearest-point check
  const pt = e.latlng;
  for (const uid in turfPolylines) {
    for (const pl of turfPolylines[uid]) {
      const lls = pl.getLatLngs();
      for (const ll of lls) {
        const dist = map.distance(pt, ll);
        if (dist < 20) {
          showTurfInfo(uid, null, getColorForUser(uid), lls.length);
          return;
        }
      }
    }
  }
}

function showTurfInfo(uid, displayName, color, pathLen) {
  const popup = document.getElementById('turf-popup');
  const content = document.getElementById('turf-popup-content');
  const isMe = uid === currentUser?.uid;
  const name = displayName || 'Unknown Runner';

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <div style="width:12px;height:12px;border-radius:50%;background:${color};flex-shrink:0;"></div>
      <strong style="font-size:16px;">${name}</strong>
      ${isMe ? `<span style="color:var(--neon);font-size:11px;font-weight:700;letter-spacing:1px;">YOU</span>` : ''}
    </div>
    <p style="color:var(--muted);font-size:13px;">
      This turf belongs to <strong style="color:var(--text);">${name}</strong>.<br>
      ${isMe
        ? 'This is your territory. Defend it!'
        : 'Run the same route to steal this turf!'}
    </p>
  `;
  popup.classList.remove('hidden');
}

/* ── Save Run ────────────────────────────────────── */
async function saveRun(km, pts) {
  const { db, collection, addDoc, serverTimestamp } = fb();
  try {
    await addDoc(collection(db, `users/${currentUser.uid}/runs`), {
      km, pts,
      duration: Math.floor((Date.now() - runStartTime) / 1000),
      createdAt: serverTimestamp(),
    });
  } catch (e) { console.warn('Save run error:', e); }
}

async function loadRecentRuns() {
  const { db, collection, getDocs, query, orderBy, limit } = fb();
  try {
    const q = query(
      collection(db, `users/${currentUser.uid}/runs`),
      orderBy('createdAt', 'desc'), limit(5)
    );
    const snap = await getDocs(q);
    const el = document.getElementById('recent-runs-list');
    if (snap.empty) { el.innerHTML = '<p style="color:var(--muted);font-size:13px;">No runs yet. Get out there!</p>'; return; }
    el.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const date = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleDateString() : 'Recent';
      el.innerHTML += `
        <div class="run-record">
          <div>
            <div class="run-record-km">${d.km.toFixed(2)} km</div>
            <div class="run-record-meta">${formatTime(d.duration || 0)} · ${date}</div>
          </div>
          <div class="run-record-pts">+${d.pts} pts</div>
        </div>`;
    });
  } catch (e) { console.warn('Load runs error:', e); }
}

/* ════════════════════════════════════════════════════
   LEADERBOARD
════════════════════════════════════════════════════ */
function initLeaderboard() {}

async function loadLeaderboard() {
  const { db, collection, getDocs, query, orderBy, limit } = fb();
  const el = document.getElementById('leaderboard-list');
  el.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const q = query(collection(db, 'users'), orderBy('points', 'desc'), limit(20));
    const snap = await getDocs(q);
    if (snap.empty) { el.innerHTML = '<p style="color:var(--muted);padding:20px;text-align:center;">No runners yet. Be the first!</p>'; return; }
    el.innerHTML = '';
    let rank = 1;
    snap.forEach(doc => {
      const d = doc.data();
      const isMe = doc.id === currentUser?.uid;
      const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
      const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      const init = (d.displayName || 'R')[0].toUpperCase();
      el.innerHTML += `
        <div class="lb-item ${isMe ? 'me' : ''}">
          <div class="lb-rank ${rankClass}">${rankEmoji}</div>
          <div class="lb-avatar">${init}</div>
          <div class="lb-info">
            <div class="lb-name">${d.displayName || 'Runner'}${isMe ? ' <span style="color:var(--neon);font-size:11px;">(you)</span>' : ''}</div>
            <div class="lb-meta">${d.totalRuns || 0} runs · ${(d.totalKm || 0).toFixed(1)} km · ${d.turfCount || 0} turf</div>
          </div>
          <div class="lb-points">${(d.points || 0).toLocaleString()}</div>
        </div>`;
      rank++;
    });
  } catch (e) {
    el.innerHTML = '<p style="color:var(--muted);padding:20px;text-align:center;">Could not load leaderboard.</p>';
    console.warn('Leaderboard error:', e);
  }
}

/* ════════════════════════════════════════════════════
   CHALLENGES
════════════════════════════════════════════════════ */
const CHALLENGES = [
  { id: 'first_run',    icon: '👟', title: 'First Steps',       desc: 'Complete your first run',            goal: 1,   unit: 'runs',   pts: 50  },
  { id: 'run_5k',       icon: '🏃', title: '5K Club',           desc: 'Run a total of 5km',                 goal: 5,   unit: 'km',     pts: 100 },
  { id: 'run_10k',      icon: '🔥', title: 'Double Digits',     desc: 'Run a total of 10km',                goal: 10,  unit: 'km',     pts: 200 },
  { id: 'claim_turf',   icon: '⬡',  title: 'Territory Marker',  desc: 'Claim your first turf',             goal: 1,   unit: 'turf',   pts: 75  },
  { id: 'claim_5turf',  icon: '🗺️', title: 'Street Boss',       desc: 'Claim 5 turf areas',                goal: 5,   unit: 'turf',   pts: 150 },
  { id: 'run_5times',   icon: '⚡', title: 'Consistent',        desc: 'Complete 5 runs',                    goal: 5,   unit: 'runs',   pts: 150 },
  { id: 'run_50k',      icon: '🏆', title: 'Marathon Soul',     desc: 'Run a total of 50km',                goal: 50,  unit: 'km',     pts: 500 },
  { id: 'claim_10turf', icon: '👑', title: 'City Ruler',        desc: 'Claim 10 turf areas',               goal: 10,  unit: 'turf',   pts: 300 },
];

function initChallenges() {
  const grid = document.getElementById('challenges-grid');
  grid.innerHTML = '';
  CHALLENGES.forEach(ch => {
    const progress = getChallengeProgress(ch);
    const pct = Math.min(100, Math.round((progress / ch.goal) * 100));
    const done = progress >= ch.goal;
    grid.innerHTML += `
      <div class="challenge-card ${done ? 'completed' : ''}">
        <div class="challenge-icon">${ch.icon}</div>
        <div class="challenge-info">
          <div class="challenge-title">${ch.title} ${done ? '✓' : ''}</div>
          <div class="challenge-desc">${ch.desc}</div>
          <div class="challenge-progress">
            <div class="challenge-bar" style="width:${pct}%"></div>
          </div>
          <div style="color:var(--muted);font-size:11px;margin-top:4px;">
            ${Math.min(progress, ch.goal)} / ${ch.goal} ${ch.unit}
          </div>
        </div>
        <div class="challenge-reward">+${ch.pts}</div>
      </div>`;
  });
}

function getChallengeProgress(ch) {
  if (!userProfile) return 0;
  if (ch.unit === 'runs') return userProfile.totalRuns || 0;
  if (ch.unit === 'km')   return Math.floor(userProfile.totalKm || 0);
  if (ch.unit === 'turf') return userProfile.turfCount || 0;
  return 0;
}

/* ════════════════════════════════════════════════════
   UTILS
════════════════════════════════════════════════════ */
function haversine(a, b) {
  const R = 6371000; // metres
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat/2) * Math.sin(dLat/2)
           + Math.cos(a.lat*Math.PI/180) * Math.cos(b.lat*Math.PI/180)
           * Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Wait for Firebase module to inject window._firebase
  let attempts = 0;
  const waitForFirebase = setInterval(() => {
    attempts++;
    if (window._firebase) {
      clearInterval(waitForFirebase);
      initTabs();
      initAuth();
    } else if (attempts > 50) {
      clearInterval(waitForFirebase);
      document.getElementById('auth-error').textContent =
        'Firebase not configured. Please add your Firebase config to index.html.';
    }
  }, 100);
});
