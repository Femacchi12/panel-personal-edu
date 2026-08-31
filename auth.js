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

const cfg = window.PANEL_CONFIG || {};
const BACKEND_MODE = Boolean(String(cfg.apiBaseUrl || '').trim());
const ALLOWED_EMAILS = new Set([
  "fernandoemacchi@gmail.com",
  "eduardo@fibrazo.com"
]);

const TOKEN_STORAGE_KEY = "panel-personal-edu.google-oauth";
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;
const ASSET_VERSION = String(document.lastModified || 'panel').replace(/\D/g, '') || 'panel';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/userinfo.email");
if (!BACKEND_MODE) provider.addScope("https://www.googleapis.com/auth/spreadsheets.readonly");
provider.setCustomParameters({ prompt: "select_account" });

window.__PANEL_GET_ID_TOKEN__ = async (forceRefresh = false) => {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(Boolean(forceRefresh));
};

const authOverlay = document.getElementById("authOverlay");
const authTitle = document.getElementById("authTitle");
const authMessage = document.getElementById("authMessage");
const signInButton = document.getElementById("googleLoginBtn");
const changeAccountButton = document.getElementById("changeAccountBtn");
const signOutButton = document.getElementById("signOutBtn");
const accountText = document.getElementById("accountText");

let dashboardLoaded = false;
let redirectHandled = false;

function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function isAuthorizedEmail(value) { return ALLOWED_EMAILS.has(normalizeEmail(value)); }
function saveToken(token) { if (token && !BACKEND_MODE) localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, savedAt: Date.now() })); }
function restoreToken() {
  if (BACKEND_MODE) return "backend";
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.savedAt || Date.now() - parsed.savedAt > TOKEN_MAX_AGE_MS) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      return null;
    }
    return parsed.token;
  } catch (_) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
}
function clearToken() { localStorage.removeItem(TOKEN_STORAGE_KEY); window.__PANEL_GOOGLE_ACCESS_TOKEN__ = null; }

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
  authMessage.textContent = email ? `La cuenta ${email} no está autorizada para ver este dashboard.` : "Esta cuenta no está autorizada para ver este dashboard.";
  signInButton.hidden = true;
  changeAccountButton.hidden = false;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${src}?v=${encodeURIComponent(ASSET_VERSION)}`;
    script.async = false;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

async function loadDashboard() {
  if (dashboardLoaded) return;
  dashboardLoaded = true;
  try {
    if (BACKEND_MODE) await loadScript("data-backend-adapter.js");
    await loadScript("regular-income-core.js");
    await loadScript("finance-purchase-policy.js");
    await loadScript("app.js");

    const modules = [
      ...(BACKEND_MODE ? ["expense-reconciliation-guard.js"] : []),
      "manual-refresh-controller.js",
      "sync-status-controller.js",
      "income-doc-enhancements.js",
      "documents-master-controller.js",
      "card-specific-filter.js",
      "card-payment-control.js",
      "card-chart-personal-limit.js",
      "card-payments-installments.js",
      "income-regular-controller.js",
      "income-type-filter.js",
      "income-savings-context-controller.js",
      "table-date-behavior.js",
      "expense-table-advanced.js",
      "flow-matrix-v3.js",
      "monthly-projection-control.js",
      "exchange-simulator.js",
      "fx-sensitivity-controller.js",
      "movement-type-columns.js",
      "payment-method-filters.js",
      "spend-chart-controller.js",
      "services-table-enhancement.js",
      "flow-income-controller.js",
      "finance-context-controller.js",
      "investment-freshness-controller.js",
      "finance-secondary-context-controller.js"
    ];
    await Promise.all(modules.map(loadScript));
    document.dispatchEvent(new CustomEvent('panel:modules-ready'));
  } catch (error) {
    console.error("Error cargando dashboard:", error);
    dashboardLoaded = false;
    showLogin("No fue posible cargar el dashboard. Actualiza la página e inténtalo nuevamente.");
  }
}

function authorize(user, token) {
  const email = normalizeEmail(user?.email);
  if (!isAuthorizedEmail(email)) { showDenied(email); return false; }
  if (!BACKEND_MODE && !token) {
    showLogin("Tu cuenta está autorizada. Confirma nuevamente con Google para habilitar la lectura privada de Finanzas Edu y Salud - Familia.");
    return false;
  }
  window.__PANEL_GOOGLE_ACCESS_TOKEN__ = BACKEND_MODE ? "backend" : token;
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
  if (BACKEND_MODE) return authorize(result.user, "backend");
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return authorize(result.user, credential?.accessToken || null);
}
async function startGoogleSignIn() {
  signInButton.disabled = true;
  authMessage.textContent = "Abriendo Google para validar tu cuenta…";
  try {
    const result = await signInWithPopup(auth, provider);
    captureResult(result);
  } catch (error) {
    const redirectCodes = new Set(["auth/popup-blocked","auth/cancelled-popup-request","auth/web-storage-unsupported","auth/operation-not-supported-in-this-environment"]);
    if (redirectCodes.has(error.code)) { await signInWithRedirect(auth, provider); return; }
    if (error.code !== "auth/popup-closed-by-user") {
      console.error("Error de autenticación:", error);
      showLogin("No fue posible iniciar sesión. Inténtalo nuevamente.");
    } else showLogin();
  } finally { signInButton.disabled = false; }
}

signInButton.addEventListener("click", startGoogleSignIn);
changeAccountButton.addEventListener("click", async () => { clearToken(); await signOut(auth); await startGoogleSignIn(); });
signOutButton?.addEventListener("click", async () => { clearToken(); await signOut(auth); location.reload(); });

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
  if (!user) { if (redirectHandled) showLogin(); return; }
  const email = normalizeEmail(user.email);
  if (!isAuthorizedEmail(email)) { clearToken(); await signOut(auth); showDenied(email); return; }
  if (BACKEND_MODE) { authorize(user, "backend"); return; }
  const restored = restoreToken();
  if (restored) { authorize(user, restored); return; }
  if (redirectHandled && !dashboardLoaded) showLogin("Cuenta autorizada. Confirma con Google para cargar los datos privados del dashboard.");
});