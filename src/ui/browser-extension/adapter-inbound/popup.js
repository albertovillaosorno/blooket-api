const words = {
  en: {
    explanation:
      "Uses your local workspace and Blooket session automatically. " +
      "Publishing is not available yet.",
    openWorkspace: "Open workspace",
    openBlooket: "Open Blooket",
    connected: "Ready",
    "waiting-for-workspace": "Waiting for the local workspace.",
    "connection-unavailable": "Start Blooket API and open its workspace.",
    "extension-update-required":
      "Update or reload Blooket API in your browser, disable older " +
      "copies, and restart the app.",
    "blooket-attention-required": "Blooket needs your attention. Open its tab.",
    "blooket-tab-unavailable":
      "The connected Blooket tab could not be focused. Reopen the workspace.",
    error: "The local service is unavailable.",
  },
  es: {
    explanation:
      "Usa automáticamente tu espacio local y tu sesión de Blooket. " +
      "La publicación aún no está disponible.",
    openWorkspace: "Abrir espacio",
    openBlooket: "Abrir Blooket",
    connected: "Listo",
    "waiting-for-workspace": "Esperando el espacio local.",
    "connection-unavailable": "Inicia Blooket API y abre su espacio.",
    "extension-update-required":
      "Actualiza o recarga Blooket API en el navegador, desactiva " +
      "las copias antiguas y reinicia la aplicación.",
    "blooket-attention-required":
      "Blooket necesita tu atención. Abre su pestaña.",
    "blooket-tab-unavailable":
      "No se pudo mostrar la pestaña conectada. Reabre el espacio local.",
    error: "El servicio local no está disponible.",
  },
};
const ui = (id) => document.getElementById(id);
let locale = navigator.language.startsWith("es") ? "es" : "en";
let connectionStatus = "waiting-for-workspace";
function render() {
  document.documentElement.lang = locale;
  ui("locale").value = locale;
  for (const id of ["explanation", "openWorkspace", "openBlooket"])
    ui(id).textContent = words[locale][id];
  ui("status").textContent =
    words[locale][connectionStatus] ?? words[locale].error;
  ui("openBlooket").disabled = ![
    "connected",
    "blooket-attention-required",
  ].includes(connectionStatus);
}
async function message(value) {
  const result = await chrome.runtime.sendMessage(value);
  if (!result || typeof result.status !== "string")
    throw new Error("invalid-status");
  connectionStatus = result.status;
  render();
}
ui("locale").addEventListener("change", (event) => {
  locale = event.target.value === "es" ? "es" : "en";
  render();
});
for (const [id, kind] of [
  ["openWorkspace", "open-workspace"],
  ["openBlooket", "open-blooket"],
])
  ui(id).addEventListener("click", () => {
    void message({ kind }).catch(() => {
      connectionStatus = "connection-unavailable";
      render();
    });
  });
render();
const refresh = () =>
  message({ kind: "status" }).catch(() => {
    connectionStatus = "connection-unavailable";
    render();
  });
void refresh();
setInterval(() => {
  void refresh();
}, 2000);
