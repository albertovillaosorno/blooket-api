const words = {
  en: {
    explanation:
      "Read Blooket in a separate tab connected to your workspace. " +
      "Sign in to Blooket yourself. Publishing is not available yet.",
    urlLabel: "Local workspace address",
    codeLabel: "Connection code",
    codeHelp:
      "Copy the code from Configuration in your local workspace. " +
      "It changes when the service restarts. Do not share it with an AI.",
    connect: "Connect Blooket",
    disconnect: "Disconnect",
    connected: "Connected",
    disconnected: "Disconnected",
    "connection-unavailable": "Open your local workspace and check the code.",
    "invalid-configuration": "Use the local address and its connection code.",
    "blooket-attention-required":
      "Open the Blooket tab and sign in or check its page.",
    error: "The connection is unavailable. Check the local workspace.",
  },
  es: {
    explanation:
      "Lee Blooket en una pestaña separada conectada a tu espacio. " +
      "Inicia sesión en Blooket tú misma. " +
      "La publicación aún no está disponible.",
    urlLabel: "Dirección del espacio local",
    codeLabel: "Código de conexión",
    codeHelp:
      "Copia el código de Configuración en tu espacio local. " +
      "Cambia al reiniciar el servicio. No lo compartas con una IA.",
    connect: "Conectar Blooket",
    disconnect: "Desconectar",
    connected: "Conectado",
    disconnected: "Desconectado",
    "connection-unavailable": "Abre tu espacio local y revisa el código.",
    "invalid-configuration": "Usa la dirección local y su código de conexión.",
    "blooket-attention-required":
      "Abre la pestaña de Blooket e inicia sesión o revisa la página.",
    error: "La conexión no está disponible. Revisa tu espacio local.",
  },
};
const ui = (id) => document.getElementById(id);
let locale = navigator.language.startsWith("es") ? "es" : "en";
let connectionStatus = "disconnected";
function render() {
  document.documentElement.lang = locale;
  ui("locale").value = locale;
  for (const id of [
    "explanation",
    "urlLabel",
    "codeLabel",
    "codeHelp",
    "connect",
    "disconnect",
  ])
    ui(id).textContent = words[locale][id];
  ui("status").textContent =
    words[locale][connectionStatus] ?? words[locale].error;
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
ui("connection").addEventListener("submit", async (event) => {
  event.preventDefault();
  ui("connect").disabled = true;
  const form = new FormData(ui("connection"));
  try {
    await message({
      kind: "connect",
      origin: form.get("origin"),
      token: form.get("token"),
    });
  } catch {
    connectionStatus = "connection-unavailable";
    render();
  } finally {
    ui("connection").elements.token.value = "";
    ui("connect").disabled = false;
  }
});
ui("disconnect").addEventListener("click", async () => {
  try {
    await message({ kind: "disconnect" });
  } catch {
    connectionStatus = "connection-unavailable";
    render();
  }
});
render();
void message({ kind: "status" }).catch(() => {
  connectionStatus = "connection-unavailable";
  render();
});
