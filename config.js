window.PANEL_CONFIG = {
  apiBaseUrl: "https://panel-personal-edu-api-926517595208.us-east1.run.app",
  googleClientId: "",
  authProvider: "firebase-google",
  allowedEmails: [
    "fernandoemacchi@gmail.com",
    "eduardo@fibrazo.com"
  ],
  financeSpreadsheetId: "1ff_dT8kHhiy1THTq1hRHGx2z2VElUQjyq_A4AL_nm4g",
  healthSpreadsheetId: "1I7Z93rrr6J-0-sP9QuBtZrMuu_t1As3lik0_WK8xqMk",
  autoRefreshMinutes: 5,
  timezone: "America/Bogota",
  primaryCurrency: "COP"
};

(() => {
  const loadPaymentFilters = () => {
    if (document.querySelector('script[data-payment-method-filters]')) return;
    const script = document.createElement('script');
    script.src = 'payment-method-filters.js?v=20260823-1629';
    script.defer = true;
    script.dataset.paymentMethodFilters = 'true';
    document.head.appendChild(script);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPaymentFilters, { once: true });
  else loadPaymentFilters();
})();
