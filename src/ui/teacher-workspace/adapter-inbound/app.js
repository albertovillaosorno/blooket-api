const words = {
  es: {
    library: "Biblioteca",
    retryOnline: "Reconectar",
    connectionRequests: "Conexiones de IA",
    consentHelp:
      "Aprueba solo la conexión que acabas de iniciar. " +
      "Tendrá acceso a biblioteca, skills y borradores; " +
      "no a los secretos.",
    approve: "Aprobar conexión",
    disabled: "Deshabilitado",
    starting: "Conectando",
    connected: "Túnel conectado",
    offline: "Sin conexión",
    missingToken: "Falta el token del túnel",
    gateway: "Puerto del gateway MCP",
    quizzes: "Quizzes",
    settings: "Configuración",
    yourSpace: "Tu espacio de enseñanza",
    libraryHelp: "Tus fotos y GIF, listos para el próximo quiz.",
    addImage: "Agregar imagen",
    search: "Buscar por nombre, descripción o tema…",
    drop: "Arrastra aquí una foto o un GIF",
    formats: "JPG · PNG · GIF · WebP — originales intactos",
    preferences: "A tu manera",
    account: "Cuenta de Blooket",
    email: "Correo",
    password: "Nueva contraseña",
    secretHelp:
      "Se guarda en el almacén seguro del sistema. Déjalo " +
      "vacío para conservarla.",
    localService: "Servicio local",
    port: "Puerto local",
    mediaFolder: "Carpeta de la biblioteca",
    chooseFolder: "Elegir carpeta",
    enableOnline: "Habilitar MCP online",
    domain: "URL pública de MCP",
    tunnelToken: "Nuevo token de Cloudflare Tunnel",
    onlineHelp:
      "Cloudflare es el único proveedor. La conexión " +
      "requiere autenticación; la UI permanece local.",
    exportDefaults: "Defaults de exportación",
    defaultsHelp:
      "Se aplican a las imágenes nuevas. Los ajustes " +
      "individuales se guardan en cada imagen.",
    width: "Ancho (px)",
    height: "Alto (px)",
    fps: "FPS de GIF",
    compression: "Compresión",
    compact: "Compacta",
    lossless: "Sin pérdida",
    limit:
      "El archivo preparado debe pesar menos de 2,5 MB. " +
      "Si no cumple, no puede continuar.",
    saveSettings: "Guardar configuración",
    diagnostics: "Diagnóstico inicial",
    runDiagnostics: "Repetir diagnóstico",
    filename: "Nombre del archivo (incluye la extensión)",
    name: "Nombre original",
    description: "Descripción original",
    originalLanguage: "Idioma del texto original",
    topics: "Temas (separados por comas)",
    cancel: "Cancelar",
    import: "Importar",
    close: "Cerrar",
    dragHelp:
      "Arrastra la imagen para moverla. Usa − y + para " + "acercar o alejar.",
    zoom: "Zoom",
    saturation: "Saturación",
    contrast: "Contraste",
    background: "Fondo",
    blur: "Difuminado",
    solid: "Color sólido",
    eyedropper: "Gotero",
    exportOptions: "Opciones de esta exportación",
    undo: "Deshacer",
    redo: "Rehacer",
    prepare: "Guardar y preparar",
    download: "Descargar archivo preparado",
    quizzesHelp:
      "La IA puede guardar borradores aquí. Revisa el " +
      "contenido antes de publicarlo.",
    connection: "Conexión con Blooket",
    publicationPending:
      "La publicación aún requiere validar el adaptador " +
      "de Blooket. Guardar un borrador no lo publica.",
    configured: "Configurado",
    missing: "Sin configurar",
    saved: "Guardado. Reinicia el servicio si cambiaste el puerto.",
    ready: "Listo",
    pending: "Por preparar",
    pickPixel: "Haz clic sobre la imagen para elegir un color.",
    noImages: "Agrega tu primera foto para empezar.",
    operationFailed:
      "No se pudo completar. Revisa los campos e inténtalo de nuevo.",
    tooLarge:
      "El resultado excede el límite. Reduce dimensiones " +
      "o FPS y vuelve a preparar; no está listo para " +
      "subir.",
    conflict: "Esta imagen cambió. Vuelve a abrirla antes de guardar.",
    collision: "Ya existe un archivo con ese nombre. Elige otro.",
    folderMac:
      "El selector de carpetas funciona en macOS. Aquí " +
      "puedes escribir la ruta.",
    partialSave:
      "La configuración no se guardó por completo. " +
      "Algunos secretos pueden haberse guardado; vuelve a " +
      "intentar.",
    diagnosticsDone: "Diagnóstico completado",
    noDrafts: "Los borradores de la IA aparecerán aquí.",
    sourceLanguage: "Original",
    english: "Inglés generado",
    stale: "Traducción pendiente de actualizar",
  },
  en: {
    library: "Library",
    retryOnline: "Reconnect",
    connectionRequests: "AI connections",
    consentHelp:
      "Approve only the connection you just initiated. It " +
      "can access media, skills and drafts; never " +
      "credentials.",
    approve: "Approve connection",
    disabled: "Disabled",
    starting: "Connecting",
    connected: "Tunnel connected",
    offline: "Offline",
    missingToken: "Tunnel token missing",
    gateway: "MCP gateway port",
    quizzes: "Quizzes",
    settings: "Settings",
    yourSpace: "Your teaching space",
    libraryHelp: "Your photos and GIFs, ready for the next quiz.",
    addImage: "Add image",
    search: "Search names, descriptions or topics…",
    drop: "Drop a photo or GIF here",
    formats: "JPG · PNG · GIF · WebP — originals preserved",
    preferences: "Make it yours",
    account: "Blooket account",
    email: "Email",
    password: "New password",
    secretHelp:
      "Saved in the system secret store. Leave empty to " +
      "keep the current value.",
    localService: "Local service",
    port: "Local port",
    mediaFolder: "Library folder",
    chooseFolder: "Choose folder",
    enableOnline: "Enable online MCP",
    domain: "Public MCP URL",
    tunnelToken: "New Cloudflare Tunnel token",
    onlineHelp:
      "Cloudflare is the only provider. The connection " +
      "requires authentication; the UI stays local.",
    exportDefaults: "Export defaults",
    defaultsHelp:
      "Applied to new images. Individual adjustments are " +
      "stored with each image.",
    width: "Width (px)",
    height: "Height (px)",
    fps: "GIF FPS",
    compression: "Compression",
    compact: "Compact",
    lossless: "Lossless",
    limit:
      "Prepared files must be smaller than 2.5 MB. Export " +
      "is blocked until they fit.",
    saveSettings: "Save settings",
    diagnostics: "First-use diagnostics",
    runDiagnostics: "Run diagnostics again",
    filename: "Filename (including extension)",
    name: "Original name",
    description: "Original description",
    originalLanguage: "Original text language",
    topics: "Topics (comma separated)",
    cancel: "Cancel",
    import: "Import",
    close: "Close",
    dragHelp: "Drag to move the image. Use − and + to zoom.",
    zoom: "Zoom",
    saturation: "Saturation",
    contrast: "Contrast",
    background: "Background",
    blur: "Blurred",
    solid: "Solid color",
    eyedropper: "Eyedropper",
    exportOptions: "Options for this export",
    undo: "Undo",
    redo: "Redo",
    prepare: "Save and prepare",
    download: "Download prepared file",
    quizzesHelp: "AI drafts appear here. Review the content before publishing.",
    connection: "Blooket connection",
    publicationPending:
      "Publishing still requires a verified Blooket " +
      "adapter. Saving a draft does not publish it.",
    configured: "Configured",
    missing: "Not configured",
    saved: "Saved. Restart the service if you changed the port.",
    ready: "Ready",
    pending: "Needs preparation",
    pickPixel: "Click the image to pick a color.",
    noImages: "Add your first photo to get started.",
    operationFailed:
      "Could not complete the operation. Check the fields " + "and try again.",
    tooLarge:
      "The result exceeds the limit. Reduce dimensions or " +
      "FPS and prepare again; it cannot be uploaded yet.",
    conflict: "This image has changed. Reopen it before saving.",
    collision: "A file with that name exists. Choose another name.",
    folderMac:
      "The folder picker works on macOS. Enter the path " +
      "here during development.",
    partialSave:
      "Settings were not fully saved. Some secrets may " +
      "have been saved; please retry.",
    diagnosticsDone: "Diagnostics completed",
    noDrafts: "Your AI drafts will appear here.",
    sourceLanguage: "Original",
    english: "Generated English",
    stale: "Translation needs updating",
  },
};
const $ = (selector) => document.querySelector(selector);
let locale = "es",
  bootstrap,
  records = [],
  selected,
  sourceFile;
let history = [],
  future = [],
  picking = false;
const t = (key) => words[locale][key] ?? key;
const field = (form, name) => form.elements.namedItem(name);
const settingsForm = $("#settingsForm"),
  editForm = $("#editForm");
function translate() {
  document.documentElement.lang = locale;
  $("#locale").value = locale;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.placeholder);
  });
  renderGallery();
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 7000);
}
function report(error) {
  const messages = {
    "rendition-byte-limit-exceeded": "tooLarge",
    "rendition-pixel-limit-exceeded": "tooLarge",
    "revision-conflict": "conflict",
    "filename-already-exists": "collision",
    "folder-picker-macos-only": "folderMac",
  };
  toast(t(messages[error.message] ?? "operationFailed"));
}
async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": bootstrap.csrf,
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok || value.ok === false)
    throw new Error(
      value.code ?? value.issues?.[0]?.code ?? "operation-failed",
    );
  return value;
}
async function command(name, payload) {
  const result = await api("/api/command", {
    version: 1,
    operationId: "ui:" + crypto.randomUUID(),
    command: name,
    payload,
  });
  return result.value;
}
async function refresh() {
  records = await api("/api/media");
  renderGallery();
}
function renderGallery() {
  const query = $("#search").value.toLocaleLowerCase();
  const filtered = records.filter((record) =>
    JSON.stringify([record.original, record.topics, record.generatedEnglish])
      .toLocaleLowerCase()
      .includes(query),
  );
  $("#count").textContent = String(filtered.length);
  $("#gallery").replaceChildren();
  for (const record of filtered) {
    const card = document.createElement("button");
    card.className = "media-card";
    const image = document.createElement("img");
    image.src = "/media/" + record.id;
    image.alt = record.original.name;
    image.loading = "lazy";
    const caption = document.createElement("div");
    caption.className = "caption";
    const name = document.createElement("strong");
    name.textContent = record.original.name;
    const description = document.createElement("p");
    description.textContent = record.original.description;
    const badge = document.createElement("span");
    badge.className = "badge" + (record.prepared ? "" : " pending");
    badge.textContent = t(record.prepared ? "ready" : "pending");
    caption.append(name, description, badge);
    if (record.generatedEnglish) {
      const translated = document.createElement("p");
      translated.textContent =
        t("english") +
        ": " +
        record.generatedEnglish.description +
        (record.generatedEnglish.sourceRevision !== record.original.revision
          ? " · " + t("stale")
          : "");
      caption.append(translated);
    }
    card.append(image, caption);
    card.addEventListener("click", () => openEditor(record));
    $("#gallery").append(card);
  }
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.textContent = t("noImages");
    $("#gallery").append(empty);
  }
}
function pickFile(file) {
  if (!file) return;
  sourceFile = file;
  const form = $("#importForm");
  field(form, "filename").value = file.name;
  field(form, "name").value = file.name.replace(/\.[^.]+$/, "");
  field(form, "description").value = "";
  field(form, "topics").value = "";
  field(form, "language").value = locale;
  $("#importDialog").showModal();
}
$("#file").addEventListener("change", (event) => {
  pickFile(event.target.files[0]);
  event.target.value = "";
});
$("#drop").addEventListener("click", () => $("#file").click());
$("#drop").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    $("#file").click();
  }
});
for (const name of ["dragenter", "dragover"])
  $("#drop").addEventListener(name, (event) => {
    event.preventDefault();
    $("#drop").classList.add("drag");
  });
for (const name of ["dragleave", "drop"])
  $("#drop").addEventListener(name, (event) => {
    event.preventDefault();
    $("#drop").classList.remove("drag");
    if (name === "drop") pickFile(event.dataTransfer.files[0]);
  });
$("#importForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target,
    button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    if (sourceFile.size > 25_000_000) throw new Error("source-too-large");
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(sourceFile);
    });
    const record = await api("/api/import", {
      filename: field(form, "filename").value,
      name: field(form, "name").value,
      description: field(form, "description").value,
      language: field(form, "language").value,
      topics: field(form, "topics")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      base64,
    });
    $("#importDialog").close();
    await refresh();
    openEditor(record);
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
});
function openEditor(record) {
  selected = structuredClone(record);
  history = [];
  future = [];
  picking = false;
  for (const name of ["name", "description", "language"])
    field(editForm, name).value = record.original[name];
  field(editForm, "topics").value = record.topics.join(", ");
  $("#editorTitle").textContent = record.original.name;
  $("#foreground").src = $("#background").src = "/media/" + record.id;
  syncRecipe();
  showPrepared();
  $("#editor").showModal();
}
function syncRecipe() {
  for (const name of [
    "zoom",
    "saturation",
    "contrast",
    "width",
    "height",
    "gifFps",
    "compression",
  ])
    field(editForm, name).value = selected.edit[name];
  field(editForm, "background").value = selected.edit.background.mode;
  field(editForm, "color").value = selected.edit.background.color;
  preview();
}
function showPrepared() {
  const prepared = selected.prepared;
  $("#preparedPreview").hidden = !prepared;
  $("#download").hidden = !prepared;
  $("#preparedState").textContent = prepared
    ? t("ready") + " · " + (prepared.bytes / 1_000_000).toFixed(3) + " MB"
    : t("limit");
  if (prepared) {
    const url =
      "/media/" +
      selected.id +
      "?variant=prepared&revision=" +
      selected.revision;
    $("#preparedPreview").src = url;
    $("#download").href = url;
    $("#download").download =
      selected.original.name +
      (prepared.file.endsWith(".gif") ? ".gif" : ".png");
  }
}
function preview() {
  if (!selected) return;
  const recipe = selected.edit,
    canvas = $("#canvas"),
    image = $("#foreground");
  canvas.style.aspectRatio = recipe.width + "/" + recipe.height;
  canvas.style.background = recipe.background.color;
  $("#background").hidden = recipe.background.mode === "solid";
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(
    bounds.width / (image.naturalWidth || 1),
    bounds.height / (image.naturalHeight || 1),
  );
  image.style.width = image.naturalWidth * scale + "px";
  image.style.height = image.naturalHeight * scale + "px";
  image.style.transform =
    `translate(calc(-50% + ${recipe.panX * bounds.width}px), ` +
    `calc(-50% + ${recipe.panY * bounds.height}px)) ` +
    `scale(${recipe.zoom})`;
  image.style.filter =
    `saturate(${recipe.saturation}) ` +
    `contrast(${recipe.contrast})`;
}
$("#foreground").addEventListener("load", preview);
window.addEventListener("resize", preview);
function remember() {
  history.push(structuredClone(selected.edit));
  history = history.slice(-50);
  future = [];
}
function invalidate() {
  selected.prepared = null;
  showPrepared();
  preview();
}
editForm.addEventListener("change", (event) => {
  const name = event.target.name;
  remember();
  if (name === "background") selected.edit.background.mode = event.target.value;
  else if (name === "color")
    selected.edit.background.color = event.target.value;
  else if (name in selected.edit)
    selected.edit[name] =
      name === "compression" ? event.target.value : Number(event.target.value);
  invalidate();
});
for (const [id, amount] of [
  ["minus", -0.1],
  ["plus", 0.1],
])
  $("#" + id).addEventListener("click", () => {
    remember();
    selected.edit.zoom = Math.max(
      0.1,
      Math.min(5, selected.edit.zoom + amount),
    );
    syncRecipe();
    invalidate();
  });
$("#undo").addEventListener("click", () => {
  if (history.length) {
    future.push(structuredClone(selected.edit));
    selected.edit = history.pop();
    syncRecipe();
    invalidate();
  }
});
$("#redo").addEventListener("click", () => {
  if (future.length) {
    history.push(structuredClone(selected.edit));
    selected.edit = future.pop();
    syncRecipe();
    invalidate();
  }
});
let drag;
$("#foreground").addEventListener("pointerdown", (event) => {
  if (picking) {
    const image = event.target,
      bounds = image.getBoundingClientRect(),
      canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(
      Math.max(
        0,
        Math.min(
          canvas.width - 1,
          Math.floor(
            ((event.clientX - bounds.left) / bounds.width) * canvas.width,
          ),
        ),
      ),
      Math.max(
        0,
        Math.min(
          canvas.height - 1,
          Math.floor(
            ((event.clientY - bounds.top) / bounds.height) * canvas.height,
          ),
        ),
      ),
      1,
      1,
    ).data;
    remember();
    selected.edit.background = {
      mode: "solid",
      color:
        "#" +
        [...pixel]
          .slice(0, 3)
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
    };
    picking = false;
    syncRecipe();
    invalidate();
    return;
  }
  remember();
  drag = {
    x: event.clientX,
    y: event.clientY,
    panX: selected.edit.panX,
    panY: selected.edit.panY,
  };
  event.target.setPointerCapture(event.pointerId);
});
$("#foreground").addEventListener("pointermove", (event) => {
  if (!drag) return;
  const bounds = $("#canvas").getBoundingClientRect();
  selected.edit.panX = Math.max(
    -10,
    Math.min(10, drag.panX + (event.clientX - drag.x) / bounds.width),
  );
  selected.edit.panY = Math.max(
    -10,
    Math.min(10, drag.panY + (event.clientY - drag.y) / bounds.height),
  );
  invalidate();
});
for (const name of ["pointerup", "pointercancel"])
  $("#foreground").addEventListener(name, () => {
    drag = undefined;
  });
$("#canvas").addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    remember();
    selected.edit.zoom = Math.max(
      0.1,
      Math.min(5, selected.edit.zoom + (event.deltaY < 0 ? 0.05 : -0.05)),
    );
    syncRecipe();
    invalidate();
  },
  { passive: false },
);
$("#eyedropper").addEventListener("click", async () => {
  if (window.EyeDropper) {
    try {
      const result = await new window.EyeDropper().open();
      remember();
      selected.edit.background = { mode: "solid", color: result.sRGBHex };
      syncRecipe();
      invalidate();
    } catch {}
  } else {
    picking = true;
    toast(t("pickPixel"));
  }
});
editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = editForm.querySelector("[type=submit]");
  button.disabled = true;
  $("#download").hidden = true;
  try {
    selected = await api("/api/edit", {
      id: selected.id,
      revision: selected.revision,
      edit: selected.edit,
      original: {
        name: field(editForm, "name").value,
        description: field(editForm, "description").value,
        language: field(editForm, "language").value,
      },
      topics: field(editForm, "topics")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    selected = await api("/api/prepare", { id: selected.id });
    showPrepared();
    await refresh();
  } catch (error) {
    showPrepared();
    await refresh().catch(() => {});
    report(error);
  } finally {
    button.disabled = false;
  }
});
function fillSettings() {
  const settings = bootstrap.preferences;
  for (const name of ["email", "mediaRoot"])
    field(settingsForm, name).value = settings[name];
  field(settingsForm, "port").value = settings.service.port;
  field(settingsForm, "online").checked = settings.online.enabled;
  field(settingsForm, "publicUrl").value = settings.online.publicUrl;
  for (const name of ["width", "height", "gifFps", "compression"])
    field(settingsForm, name).value = settings.defaults[name];
  $("#onlineFields").disabled = !settings.online.enabled;
  $("#passwordState").textContent = t(
    bootstrap.secrets.passwordConfigured ? "configured" : "missing",
  );
  $("#tunnelState").textContent = t(
    bootstrap.secrets.tunnelConfigured ? "configured" : "missing",
  );
  $("#diagnostics").textContent = bootstrap.diagnostic.checks
    .map((check) => check.name + ": " + check.status)
    .join(" · ");
}
field(settingsForm, "online").addEventListener("change", (event) => {
  $("#onlineFields").disabled = !event.target.checked;
});
settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = settingsForm.querySelector("[type=submit]");
  button.disabled = true;
  const preferences = structuredClone(bootstrap.preferences);
  preferences.locale = locale;
  preferences.email = field(settingsForm, "email").value;
  preferences.mediaRoot = field(settingsForm, "mediaRoot").value;
  preferences.service.port = Number(field(settingsForm, "port").value);
  preferences.online.enabled = field(settingsForm, "online").checked;
  preferences.online.publicUrl = field(settingsForm, "publicUrl").value;
  for (const name of ["width", "height", "gifFps", "compression"])
    preferences.defaults[name] =
      name === "compression"
        ? field(settingsForm, name).value
        : Number(field(settingsForm, name).value);
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": bootstrap.csrf,
      },
      body: JSON.stringify({
        preferences,
        password: field(settingsForm, "password").value,
        tunnelToken: field(settingsForm, "tunnelToken").value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.code);
    if (!result.ok) {
      toast(t("partialSave"));
      return;
    }
    bootstrap = await api("/api/bootstrap");
    fillSettings();
    toast(t("saved"));
    await refresh();
  } catch (error) {
    report(error);
  } finally {
    field(settingsForm, "password").value = "";
    field(settingsForm, "tunnelToken").value = "";
    button.disabled = false;
  }
});
$("#folder").addEventListener("click", async () => {
  try {
    field(settingsForm, "mediaRoot").value = (
      await api("/api/folder", {})
    ).path;
  } catch (error) {
    report(error);
  }
});
$("#rerun").addEventListener("click", async () => {
  try {
    bootstrap.diagnostic = await api("/api/diagnostics", {});
    fillSettings();
    toast(t("diagnosticsDone"));
  } catch (error) {
    report(error);
  }
});
$("#locale").addEventListener("change", (event) => {
  locale = event.target.value;
  translate();
  fillSettings();
});
$("#search").addEventListener("input", renderGallery);
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      $("#" + button.dataset.close).close(),
    ),
  );
document.querySelectorAll("[data-tab]").forEach((button) =>
  button.addEventListener("click", async () => {
    document.querySelectorAll(".view").forEach((view) => {
      view.hidden = view.id !== button.dataset.tab;
    });
    document.querySelectorAll("[data-tab]").forEach((item) => {
      item.removeAttribute("aria-current");
    });
    button.setAttribute("aria-current", "page");
    if (button.dataset.tab === "quizzes") {
      try {
        const ids = await command("drafts.list", {});
        $("#drafts").replaceChildren();
        if (!ids.length) {
          const text = document.createElement("p");
          text.textContent = t("noDrafts");
          $("#drafts").append(text);
        }
        for (const id of ids) {
          const result = await command("drafts.get", { id });
          const article = document.createElement("article"),
            title = document.createElement("h2"),
            text = document.createElement("pre");
          title.textContent = result.document.title;
          text.textContent = JSON.stringify(result.document, null, 2);
          article.append(title, text);
          $("#drafts").append(article);
        }
      } catch (error) {
        report(error);
      }
    }
  }),
);
try {
  bootstrap = await api("/api/bootstrap");
  locale = bootstrap.preferences.locale;
  translate();
  fillSettings();
  await refresh();
} catch (error) {
  translate();
  report(error);
}

async function refreshConnections() {
  if (!bootstrap) return;
  try {
    const connections = await api("/api/connections");
    const target = $("#onlineStatus");
    const state = connections.status.state;
    if (target)
      target.textContent =
        t(
          state === "tunnel-token-missing"
            ? "missingToken"
            : ["disabled", "starting", "connected"].includes(state)
              ? state
              : "offline",
        ) +
        " · " +
        t("gateway") +
        ": " +
        (connections.status.gatewayPort ?? 2608);
    const container = $("#connections");
    if (!container) return;
    container.replaceChildren();
    for (const request of connections.requests) {
      const paragraph = document.createElement("p");
      paragraph.textContent =
        request.client + " · " + request.id + " · " + request.redirect;
      const button = document.createElement("button");
      button.textContent = t("approve");
      button.addEventListener("click", async () => {
        try {
          await api("/api/connection-approve", { id: request.id });
          await refreshConnections();
        } catch (error) {
          report(error);
        }
      });
      container.append(paragraph, button);
    }
  } catch {}
}
$("#retryOnline")?.addEventListener("click", async () => {
  try {
    await api("/api/online-retry", {});
    await refreshConnections();
  } catch (error) {
    report(error);
  }
});
await refreshConnections();
setInterval(refreshConnections, 5000);
