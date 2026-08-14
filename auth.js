import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDBmVNRqmjy_bt2UovRtmZVNpKrCTyNjLU",
  authDomain: "dashboards-fibrazo.firebaseapp.com",
  projectId: "dashboards-fibrazo",
  storageBucket: "dashboards-fibrazo.firebasestorage.app",
  messagingSenderId: "926517595208",
  appId: "1:926517595208:web:c1ae62107ee8bacad51c7d"
};

const ALLOWED_EMAILS = new Set([
  "fernandoemacchi@gmail.com",
  "eduardo@fibrazo.com"
]);

const TOKEN_STORAGE_KEY = "panel-personal-edu.google-oauth";
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/spreadsheets.readonly");
provider.addScope("https://www.googleapis.com/auth/userinfo.email");
provider.setCustomParameters({ prompt: "select_account" });

const authOverlay = document.getElementById("authOverlay");
const authTitle = document.getElementById("authTitle");
const authMessage = document.getElementById("authMessage");
const signInButton = document.getElementById("googleLoginBtn");
const changeAccountButton = document.getElementById("changeAccountBtn");
const signOutButton = document.getElementById("signOutBtn");
const accountText = document.getElementById("accountText");

let dashboardLoaded = false;
let redirectHandled = false;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isAuthorizedEmail(value) {
  return ALLOWED_EMAILS.has(normalizeEmail(value));
}

function saveToken(token) {
  if (!token) return;
  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, savedAt: Date.now() }));
}

function restoreToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.savedAt || Date.now() - parsed.savedAt > TOKEN_MAX_AGE_MS) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return null;
    }
    return parsed.token;
  } catch (_) {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  window.__PANEL_GOOGLE_ACCESS_TOKEN__ = null;
}

function showLogin(message = "Inicia sesión con una de las dos cuentas autorizadas para continuar.") {
  document.body.classList.remove("auth-authorized", "auth-denied");
  document.body.classList.add("auth-pending");
  authOverlay.classList.remove("hidden");
  authTitle.textContent = "Panel Personal Edu";
  authMessage.textContent = message;
  signInButton.hidden = false;
  changeAccountButton.hidden = true;
}

function showDenied(email) {
  document.body.classList.remove("auth-pending", "auth-authorized");
  document.body.classList.add("auth-denied");
  authOverlay.classList.remove("hidden");
  authTitle.textContent = "Acceso denegado";
  authMessage.textContent = email
    ? `La cuenta ${email} no está autorizada para ver este dashboard.`
    : "Esta cuenta no está autorizada para ver este dashboard.";
  signInButton.hidden = true;
  changeAccountButton.hidden = false;
}

function loadDashboard() {
  if (dashboardLoaded) return;
  dashboardLoaded = true;
  const script = document.createElement("script");
  script.src = `app-loader.js?v=${Date.now()}`;
  script.defer = true;
  script.onerror = () => {
    dashboardLoaded = false;
    showLogin("No fue posible cargar el dashboard. Actualiza la página e inténtalo nuevamente.");
  };
  document.body.appendChild(script);
}

function authorize(user, token) {
  const email = normalizeEmail(user?.email);
  if (!isAuthorizedEmail(email)) {
    showDenied(email);
    return false;
  }
  if (!token) {
    showLogin("Tu cuenta está autorizada. Confirma nuevamente con Google para habilitar la lectura privada de Finanzas Edu y Salud - Familia.");
    return false;
  }

  window.__PANEL_GOOGLE_ACCESS_TOKEN__ = token;
  saveToken(token);
  document.body.classList.remove("auth-pending", "auth-denied");
  document.body.classList.add("auth-authorized");
  authOverlay.classList.add("hidden");
  accountText.textContent = email;
  loadDashboard();
  return true;
}

function captureResult(result) {
  if (!result?.user) return false;
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken || null;
  return authorize(result.user, token);
}

async function startGoogleSignIn() {
  signInButton.disabled = true;
  authMessage.textContent = "Abriendo Google para validar tu cuenta…";
  try {
    const result = await signInWithPopup(auth, provider);
    captureResult(result);
  } catch (error) {
    const redirectCodes = new Set([
      "auth/popup-blocked",
      "auth/cancelled-popup-request",
      "auth/web-storage-unsupported",
      "auth/operation-not-supported-in-this-environment"
    ]);
    if (redirectCodes.has(error.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (error.code !== "auth/popup-closed-by-user") {
      console.error("Error de autenticación:", error);
      showLogin("No fue posible iniciar sesión. Inténtalo nuevamente.");
    } else {
      showLogin();
    }
  } finally {
    signInButton.disabled = false;
  }
}

signInButton.addEventListener("click", startGoogleSignIn);
changeAccountButton.addEventListener("click", async () => {
  clearToken();
  await signOut(auth);
  await startGoogleSignIn();
});
signOutButton?.addEventListener("click", async () => {
  clearToken();
  await signOut(auth);
  location.reload();
});

try {
  const redirectResult = await getRedirectResult(auth);
  redirectHandled = true;
  if (redirectResult) captureResult(redirectResult);
} catch (error) {
  redirectHandled = true;
  console.error("Error al completar la redirección:", error);
  showLogin("No fue posible completar el inicio de sesión. Inténtalo nuevamente.");
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    if (redirectHandled) showLogin();
    return;
  }

  const email = normalizeEmail(user.email);
  if (!isAuthorizedEmail(email)) {
    clearToken();
    await signOut(auth);
    showDenied(email);
    return;
  }

  const restored = restoreToken();
  if (restored) {
    authorize(user, restored);
    return;
  }

  if (redirectHandled && !dashboardLoaded) {
    showLogin("Cuenta autorizada. Confirma con Google para cargar los datos privados del dashboard.");
  }
});
