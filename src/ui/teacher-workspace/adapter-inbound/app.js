import {
  GALLERY_LIMIT,
  sampleLibrary,
  representativeSolidColor,
  clipboardImageUrl,
  readClipboardImage,
} from "./library.js";

const words = {
  es: {
    library: "Biblioteca",
    save: "Guardar",
    migrateLibrary: "Importar la biblioteca anterior",
    migrationConfirm:
      "Importar los archivos anteriores de esta carpeta? " +
      "Se conservarán los originales y una copia del índice.",
    invalidFilename: "Usa una ruta relativa y conserva el formato de imagen.",
    recoveryRequired:
      "Hay una transferencia pendiente. Reinicia el servicio " +
      "para recuperar su registro antes de continuar.",
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
    pasteImage: "Pegar",
    shuffleLibrary: "Otra selección",
    previousPage: "Anterior",
    nextPage: "Siguiente",
    shownOf: "de",
    clipboardEmpty: "Copia una imagen o un enlace directo a una imagen.",
    clipboardDenied:
      "Permite leer el portapapeles o pega aquí con Ctrl+V / ⌘V.",
    downloadFailed: "No se pudo cargar esa imagen. Prueba otro enlace directo.",
    search: "Buscar por nombre, descripción o tema…",
    drop: "Arrastra aquí una foto o un GIF",
    formats: "JPG · PNG · GIF · WebP — optimizados al importar",
    preferences: "A tu manera",
    account: "Cuenta de Blooket",
    email: "Correo",
    password: "Nueva contraseña",
    ownerPassword: "Nueva contraseña para aprobar conexiones de IA",
    approvalPassword: "Contraseña del propietario",
    ownerHelp:
      "Es necesaria para aprobar conexiones. Escríbela solo aquí, " +
      "en la página local. El nombre del cliente no prueba su identidad.",
    ownerMissing: "Configura la contraseña del propietario",
    wrongOwner: "Contraseña incorrecta. La conexión no se aprobó.",
    approvalLimit:
      "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
    reject: "Rechazar",
    revoke: "Revocar acceso",
    requestedAccess: "Acceso solicitado",
    secretHelp:
      "Se guarda en el almacén seguro del sistema. Déjalo " +
      "vacío para conservarla.",
    localService: "Servicio local",
    port: "Puerto local",
    portMode: "Si el puerto está ocupado",
    fixedPort: "Avisar y detener",
    automaticPort: "Elegir otro puerto local",
    theme: "Apariencia",
    systemTheme: "Usar la del sistema",
    lightTheme: "Clara",
    darkTheme: "Oscura",
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
    lossless: "JPEG de mayor calidad / paleta estándar GIF",
    qualityHelp: "Los GIF siempre usan paleta; esto no significa sin pérdida.",
    previewHelp:
      "Esta vista muestra el encuadre. Revisa el archivo preparado " +
      "para confirmar colores, compresión y ritmo del GIF.",
    canvasLabel: "Vista de encuadre. Flechas para mover; − y + para el zoom.",
    colorLabel: "Color del fondo",
    zoomOut: "Alejar",
    zoomIn: "Acercar",
    preparedLabel: "Imagen preparada",
    diagRuntime: "Versión del servicio",
    diagMac: "Compatibilidad macOS",
    diagSettings: "Configuración",
    diagStorage: "Acceso a archivos",
    diagOnline: "Conexión online",
    diagImage: "Procesamiento de imágenes",
    diagSecrets: "Cliente del almacén seguro",
    passed: "Correcto",
    failed: "Falló",
    unconfigured: "Sin configurar",
    unverified: "Sin comprobar",
    nativeTimeout:
      "La imagen tardó demasiado. Reduce las dimensiones o usa " +
      "un GIF más corto y vuelve a intentarlo.",
    gifLimits:
      "El GIF supera los límites de duración o cuadros. Usa un clip " +
      "más corto o reduce los FPS de exportación.",
    sourceTooLarge: "El original supera 25 MB. Elige una copia más pequeña.",
    invalidImage: "No se pudo decodificar la imagen. Revisa el archivo.",
    stalePrepared: "La imagen cambió. Vuelve a guardarla y prepararla.",
    processing: "Optimizando y comprobando el archivo…",
    saveSettings: "Guardar configuración",
    diagnostics: "Diagnóstico inicial",
    runDiagnostics: "Repetir diagnóstico",
    filename: "Nombre del archivo (incluye la extensión)",
    name: "Nombre",
    description: "Descripción",
    originalLanguage: "Idioma del texto",
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
      "No se pudo preparar un archivo válido bajo el límite. " +
      "La imagen sigue editable.",
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
    stale: "Normalización pendiente de actualizar",
    normalizationPending: "Análisis AI pendiente",
    normalizationCompleted: "Análisis AI listo",
    normalizationStale: "Análisis AI desactualizado",
  },
  en: {
    library: "Library",
    save: "Save",
    migrateLibrary: "Import the previous library",
    migrationConfirm:
      "Import previous files from this folder? " +
      "Original files and a copy of the index will be preserved.",
    invalidFilename: "Use a relative path and keep the actual image format.",
    recoveryRequired:
      "A transfer is pending. Restart the service to recover " +
      "its journal before continuing.",
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
    pasteImage: "Paste",
    shuffleLibrary: "Another selection",
    previousPage: "Previous",
    nextPage: "Next",
    shownOf: "of",
    clipboardEmpty: "Copy an image or a direct image link first.",
    clipboardDenied: "Allow clipboard access or paste here with Ctrl+V / ⌘V.",
    downloadFailed: "Could not load that image. Try another direct image link.",
    search: "Search names, descriptions or topics…",
    drop: "Drop a photo or GIF here",
    formats: "JPG · PNG · GIF · WebP — optimized on import",
    preferences: "Make it yours",
    account: "Blooket account",
    email: "Email",
    password: "New password",
    ownerPassword: "New password for approving AI connections",
    approvalPassword: "Owner password",
    ownerHelp:
      "Required to approve connections. Enter it only here, on the local " +
      "page. A client's name does not prove its identity.",
    ownerMissing: "Configure an owner password",
    wrongOwner: "Incorrect password. The connection was not approved.",
    approvalLimit: "Too many attempts. Wait a minute and try again.",
    reject: "Reject",
    revoke: "Revoke access",
    requestedAccess: "Requested access",
    secretHelp:
      "Saved in the system secret store. Leave empty to " +
      "keep the current value.",
    localService: "Local service",
    port: "Local port",
    portMode: "When the port is busy",
    fixedPort: "Report and stop",
    automaticPort: "Choose another local port",
    theme: "Appearance",
    systemTheme: "Follow the system",
    lightTheme: "Light",
    darkTheme: "Dark",
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
    lossless: "Higher-quality JPEG / standard GIF palette",
    qualityHelp: "GIFs always use a palette; this does not mean lossless.",
    previewHelp:
      "This view shows framing. Review the prepared file to confirm " +
      "colors, compression and GIF timing.",
    canvasLabel: "Framing preview. Arrow keys move; − and + change zoom.",
    colorLabel: "Background color",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    preparedLabel: "Prepared image",
    diagRuntime: "Service runtime",
    diagMac: "macOS compatibility",
    diagSettings: "Configuration",
    diagStorage: "File access",
    diagOnline: "Online connection",
    diagImage: "Image processing",
    diagSecrets: "Secret-store client",
    passed: "Passed",
    failed: "Failed",
    unconfigured: "Unconfigured",
    unverified: "Unverified",
    nativeTimeout:
      "Image processing took too long. Reduce dimensions or use " +
      "a shorter GIF and try again.",
    gifLimits:
      "The GIF exceeds duration or frame limits. Use a shorter clip " +
      "or reduce export FPS.",
    sourceTooLarge: "The original exceeds 25 MB. Choose a smaller copy.",
    invalidImage: "The image could not be decoded. Check the source file.",
    stalePrepared: "The image changed. Save and prepare it again.",
    processing: "Optimizing and checking the prepared file…",
    saveSettings: "Save settings",
    diagnostics: "First-use diagnostics",
    runDiagnostics: "Run diagnostics again",
    filename: "Filename (including extension)",
    name: "Name",
    description: "Description",
    originalLanguage: "Text language",
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
      "A valid file could not be prepared under the limit. " +
      "The image remains editable.",
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
    stale: "English normalization needs updating",
    normalizationPending: "AI analysis pending",
    normalizationCompleted: "AI analysis ready",
    normalizationStale: "AI analysis stale",
  },
};
const $ = (selector) => document.querySelector(selector);
let locale = "es",
  bootstrap,
  records = [],
  selected,
  sourceFile,
  sourcePreviewUrl,
  sourceBase64,
  sourceBase64Promise,
  animatedColorSuggestion;
let editorBusy = false,
  preparedDirty = false,
  preparing = false,
  hadPreparedPreview = false;
let clipboardReading = false;
let suggestions = [],
  searchIndex = [],
  searchPage = 0,
  clipboardBusy = false;
let history = [],
  future = [],
  picking = false,
  solidColorSuggested = false,
  solidColorTouched = false;
const t = (key) => words[locale][key] ?? key;
const field = (form, name) => form.elements.namedItem(name);
const settingsForm = $("#settingsForm"),
  editForm = $("#editForm");
function setEditorBusy(value) {
  editorBusy = value;
  Array.from(editForm.elements).forEach((control) => {
    control.disabled = value;
  });
  if (value) $("#canvas").setAttribute("aria-disabled", "true");
  else $("#canvas").removeAttribute("aria-disabled");
}
function translate() {
  document.documentElement.lang = locale;
  $("#locale").value = locale;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.placeholder);
  });
  document.querySelectorAll("[data-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.aria));
  });
  $("#preparedPreview").alt = t("preparedLabel");
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
    "owner-password-invalid": "wrongOwner",
    "owner-password-unavailable": "ownerMissing",
    "owner-approval-rate-limited": "approvalLimit",
    "rendition-byte-limit-exceeded": "tooLarge",
    "rendition-pixel-limit-exceeded": "tooLarge",
    "revision-conflict": "conflict",
    "filename-already-exists": "collision",
    "source-too-large": "sourceTooLarge",
    "clipboard-image-missing": "clipboardEmpty",
    "invalid-image-url": "downloadFailed",
    "image-url-not-public": "downloadFailed",
    "image-download-not-image": "downloadFailed",
    "image-download-failed": "downloadFailed",
    "image-download-timeout": "downloadFailed",
    "image-download-redirect-limit": "downloadFailed",
    "native-media-timeout": "nativeTimeout",
    "migration-preflight-timeout": "nativeTimeout",
    "image-frame-limit-exceeded": "gifLimits",
    "invalid-editor-rendition": "gifLimits",
    "invalid-or-oversized-library-file": "tooLarge",
    "prepared-revision-conflict": "stalePrepared",
    "prepared-media-invalid": "invalidImage",
    "image-decode-failed": "invalidImage",
    "invalid-user-filename": "invalidFilename",
    "filename-format-mismatch": "invalidFilename",
    "library-recovery-required": "recoveryRequired",
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
  suggestions = sampleLibrary(records);
  searchIndex = records.map((record) => ({
    record,
    text: JSON.stringify([
      record.original,
      record.topics,
      record.generatedEnglish,
    ]).toLocaleLowerCase(),
  }));
  searchPage = 0;
  renderGallery();
  const status = await api("/api/library-status");
  $("#migrateLibrary").hidden = !status.legacyAvailable;
}
$("#migrateLibrary").addEventListener("click", async () => {
  if (!window.confirm(t("migrationConfirm"))) return;
  const button = $("#migrateLibrary");
  button.disabled = true;
  try {
    await api("/api/library-migrate", { confirm: true });
    await refresh();
  } catch (error) {
    report(error);
  } finally {
    button.disabled = false;
  }
});
function renderGallery() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  const filtered = query
    ? searchIndex
        .filter((entry) => entry.text.includes(query))
        .map((entry) => entry.record)
    : records;
  searchPage = Math.min(
    searchPage,
    Math.max(0, Math.ceil(filtered.length / GALLERY_LIMIT) - 1),
  );
  const visible = query
    ? filtered.slice(
        searchPage * GALLERY_LIMIT,
        (searchPage + 1) * GALLERY_LIMIT,
      )
    : suggestions;
  $("#count").textContent =
    query && filtered.length
      ? `${searchPage * GALLERY_LIMIT + 1}–` +
        `${searchPage * GALLERY_LIMIT + visible.length} ${t("shownOf")} ` +
        filtered.length
      : `${visible.length} ${t("shownOf")} ${filtered.length}`;
  $("#shuffleLibrary").hidden = !!query || records.length <= GALLERY_LIMIT;
  $("#searchPages").hidden = !query || filtered.length <= GALLERY_LIMIT;
  $("#previousPage").disabled = searchPage === 0;
  $("#nextPage").disabled = (searchPage + 1) * GALLERY_LIMIT >= filtered.length;
  $("#gallery").replaceChildren();
  for (const record of visible) {
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
    const normalization = document.createElement("span");
    normalization.className =
      "badge" + (record.normalizationStatus === "completed" ? "" : " pending");
    normalization.textContent = t(
      record.normalizationStatus === "completed"
        ? "normalizationCompleted"
        : record.normalizationStatus === "stale"
          ? "normalizationStale"
          : "normalizationPending",
    );
    caption.append(name, description, badge, normalization);
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
$("#shuffleLibrary").addEventListener("click", () => {
  suggestions = sampleLibrary(records);
  renderGallery();
});
$("#previousPage").addEventListener("click", () => {
  searchPage--;
  renderGallery();
});
$("#nextPage").addEventListener("click", () => {
  searchPage++;
  renderGallery();
});
async function pasteSource(source) {
  if (clipboardBusy) return;
  clipboardBusy = true;
  $("#pasteImage").disabled = true;
  try {
    let image = source.image;
    if (source.url) {
      const response = await fetch("/api/image-source", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": bootstrap.csrf,
        },
        body: JSON.stringify({ url: source.url }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.code ?? "image-download-failed");
      }
      image = await response.blob();
    }
    if (!image || image.size > 25_000_000) throw new Error("source-too-large");
    const extension =
      image.type === "image/jpeg" ? "jpg" : (image.type.split("/")[1] ?? "png");
    pickFile(new File([image], `image.${extension}`, { type: image.type }));
  } catch (error) {
    report(error);
  } finally {
    clipboardBusy = false;
    $("#pasteImage").disabled = false;
  }
}
$("#pasteImage").addEventListener("click", async () => {
  if (clipboardBusy || clipboardReading) return;
  clipboardReading = true;
  $("#pasteImage").disabled = true;
  try {
    if (!navigator.clipboard) throw new Error("clipboard-unavailable");
    await pasteSource(await readClipboardImage(navigator.clipboard));
  } catch (error) {
    if (error.message === "clipboard-image-missing") report(error);
    else toast(t("clipboardDenied"));
  } finally {
    clipboardReading = false;
    $("#pasteImage").disabled = clipboardBusy;
  }
});
function clearSourceDraft(preserveColor = false) {
  sourceFile = undefined;
  sourceBase64 = undefined;
  sourceBase64Promise = undefined;
  if (!preserveColor) animatedColorSuggestion = undefined;
  if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
  sourcePreviewUrl = undefined;
}
async function fileBase64(file) {
  if (file === sourceFile && sourceBase64) return sourceBase64;
  if (file === sourceFile && sourceBase64Promise)
    return await sourceBase64Promise;
  const pending = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  if (file === sourceFile) sourceBase64Promise = pending;
  try {
    const value = await pending;
    if (file === sourceFile) sourceBase64 = value;
    return value;
  } finally {
    if (file === sourceFile && sourceBase64Promise === pending)
      sourceBase64Promise = undefined;
  }
}
async function loadAnimatedColorSuggestion(target, id) {
  try {
    const file = sourceFile;
    const payload = id
      ? { id }
      : file
        ? { base64: await fileBase64(file) }
        : undefined;
    if (!payload) return;
    const sampled = await api("/api/media-color-samples", payload);
    const color = representativeSolidColor(
      new Uint8ClampedArray(sampled.rgba),
    );
    if (!color || selected !== target || !$("#editor").open) return;
    animatedColorSuggestion = color;
    if (selected.edit.background.mode === "solid") {
      suggestSolidColor();
      preview();
    }
  } catch {}
}
function pickFile(file) {
  if (!file) return;
  if (file.size > 25_000_000) {
    report(new Error("source-too-large"));
    return;
  }
  clearSourceDraft();
  sourceFile = file;
  sourcePreviewUrl = URL.createObjectURL(file);
  const defaults = bootstrap.preferences.defaults;
  openEditor(
    {
      id: "",
      asset: file.type === "image/gif" ? "draft.gif" : "draft.webp",
      revision: 0,
      original: {
        revision: 1,
        name: file.name.replace(/\.[^.]+$/, ""),
        description: "",
        language: "",
      },
      topics: [],
      generatedEnglish: null,
      edit: {
        ...defaults,
        panX: 0,
        panY: 0,
        zoom: 1,
        contrast: 1,
        saturation: 1,
        background: { mode: "blur", color: "#ffffff" },
      },
      prepared: null,
    },
    sourcePreviewUrl,
  );
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
window.addEventListener("paste", (event) => {
  if (
    $("#library").hidden ||
    document.querySelector("dialog[open]") ||
    event.target.closest?.("input,textarea,[contenteditable=true]")
  )
    return;
  const image = [...(event.clipboardData?.files ?? [])].find((file) =>
    file.type.startsWith("image/"),
  );
  const url = clipboardImageUrl(event.clipboardData?.getData("text/plain"));
  if (!image && !url) return;
  event.preventDefault();
  void pasteSource(image ? { image } : { url });
});
function openEditor(record, sourceUrl) {
  if (editorBusy) {
    toast(t("exportBusy"));
    return;
  }
  selected = structuredClone(record);
  preparedDirty = false;
  preparing = false;
  hadPreparedPreview = Boolean(record.prepared);
  history = [];
  future = [];
  picking = false;
  solidColorSuggested =
    record.edit.background.mode === "solid" ||
    record.edit.background.color !== "#ffffff";
  solidColorTouched = false;
  recipeGesture = undefined;
  for (const name of ["name", "description"])
    field(editForm, name).value = record.original[name];
  $("#editorTitle").textContent = record.original.name || t("addImage");
  const mediaUrl = sourceUrl ?? "/media/" + record.id;
  $("#foreground").src = $("#background").src = mediaUrl;
  syncRecipe();
  showPrepared();
  $("#editor").showModal();
  if (record.asset.endsWith(".gif") && !solidColorSuggested) {
    const target = selected;
    void loadAnimatedColorSuggestion(target, record.id || undefined);
  }
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
  const current = Boolean(prepared) && !preparedDirty && !preparing;
  $("#download").hidden = !current;
  $("#preparedPreview").hidden = current ? false : !hadPreparedPreview;
  $("#preparedState").textContent = preparing
    ? t("processing")
    : current
      ? t("ready") + " · " + (prepared.bytes / 1_000_000).toFixed(3) + " MB"
      : t("pending");
  if (current) {
    const url =
      "/media/" +
      selected.id +
      "?variant=prepared&revision=" +
      selected.revision;
    $("#preparedPreview").src = url;
    $("#download").href = url;
    $("#download").download =
      selected.original.name +
      (prepared.file.endsWith(".gif")
        ? ".gif"
        : prepared.file.endsWith(".jpg")
          ? ".jpg"
          : ".png");
    hadPreparedPreview = true;
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
    `saturate(${recipe.saturation}) ` + `contrast(${recipe.contrast})`;
}
function suggestSolidColor() {
  if (!selected || solidColorSuggested || solidColorTouched) return;
  let color = animatedColorSuggestion;
  if (!selected.asset.endsWith(".gif")) {
    const image = $("#foreground");
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0, 8, 8);
    color = representativeSolidColor(
      context.getImageData(0, 0, 8, 8).data,
    );
  }
  if (!color) return;
  selected.edit.background.color = color;
  solidColorSuggested = true;
  field(editForm, "color").value = color;
}
$("#foreground").addEventListener("load", () => {
  preview();
  if (selected?.edit.background.mode === "solid") {
    suggestSolidColor();
    preview();
  }
});
window.addEventListener("resize", preview);
function remember() {
  history.push(structuredClone(selected.edit));
  history = history.slice(-50);
  future = [];
}
function invalidate() {
  preparedDirty = true;
  showPrepared();
  preview();
}
let recipeGesture;
editForm.addEventListener("input", (event) => {
  if (editorBusy) return;
  const name = event.target.name;
  const recipeField =
    name in selected.edit || ["background", "color"].includes(name);
  if (recipeField && event.target.validity && !event.target.validity.valid)
    return;
  if (recipeField && recipeGesture !== event.target) {
    remember();
    recipeGesture = event.target;
  }
  if (name === "background") {
    selected.edit.background.mode = event.target.value;
    if (event.target.value === "solid") suggestSolidColor();
  } else if (name === "color") {
    solidColorTouched = true;
    selected.edit.background.color = event.target.value;
  }
  else if (name in selected.edit)
    selected.edit[name] =
      name === "compression" ? event.target.value : Number(event.target.value);
  invalidate();
});
editForm.addEventListener("change", () => {
  recipeGesture = undefined;
});
editForm.addEventListener("focusout", () => {
  recipeGesture = undefined;
});
$("#canvas").addEventListener("keydown", (event) => {
  if (editorBusy) return;
  const step = event.shiftKey ? 0.1 : 0.01;
  const moves = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = moves[event.key];
  if (!move && !["+", "=", "-"].includes(event.key)) return;
  event.preventDefault();
  remember();
  if (move) {
    selected.edit.panX = Math.max(
      -10,
      Math.min(10, selected.edit.panX + move[0]),
    );
    selected.edit.panY = Math.max(
      -10,
      Math.min(10, selected.edit.panY + move[1]),
    );
  } else
    selected.edit.zoom = Math.max(
      0.1,
      Math.min(5, selected.edit.zoom + (event.key === "-" ? -0.1 : 0.1)),
    );
  syncRecipe();
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
  if (editorBusy) return;
  if (picking) {
    const image = event.target,
      bounds = image.getBoundingClientRect(),
      canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const sourceX = Math.max(
      0,
      Math.min(
        image.naturalWidth - 1,
        Math.floor(
          ((event.clientX - bounds.left) / bounds.width) * image.naturalWidth,
        ),
      ),
    );
    const sourceY = Math.max(
      0,
      Math.min(
        image.naturalHeight - 1,
        Math.floor(
          ((event.clientY - bounds.top) / bounds.height) * image.naturalHeight,
        ),
      ),
    );
    const context = canvas.getContext("2d");
    context.drawImage(image, sourceX, sourceY, 1, 1, 0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    remember();
    solidColorTouched = true;
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
    if (editorBusy) return;
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
  if (editorBusy) return;
  const target = selected;
  if (window.EyeDropper) {
    try {
      const result = await new window.EyeDropper().open();
      if (editorBusy || selected !== target || !$("#editor").open) return;
      remember();
      solidColorTouched = true;
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
  if (editorBusy) return;
  setEditorBusy(true);
  drag = undefined;
  preparing = true;
  showPrepared();
  try {
    const original = {
      name: field(editForm, "name").value,
      description: field(editForm, "description").value,
    };
    if (sourceFile) {
      if (sourceFile.size > 25_000_000) throw new Error("source-too-large");
      const file = sourceFile;
      const base64 = await fileBase64(file);
      selected = await api("/api/import", {
        ...original,
        base64,
        edit: selected.edit,
      });
      const canonicalUrl = "/media/" + selected.id;
      $("#foreground").src = $("#background").src = canonicalUrl;
      $("#editorTitle").textContent = selected.original.name;
      clearSourceDraft(true);
    } else {
      selected = await api("/api/edit", {
        id: selected.id,
        revision: selected.revision,
        edit: selected.edit,
        original,
      });
    }
    selected = await api("/api/prepare", { id: selected.id });
    preparedDirty = false;
    preparing = false;
    showPrepared();
    await refresh();
  } catch (error) {
    preparing = false;
    showPrepared();
    await refresh().catch(() => {});
    report(error);
  } finally {
    setEditorBusy(false);
  }
});
function fillSettings() {
  const settings = bootstrap.preferences;
  for (const name of ["email", "mediaRoot"])
    field(settingsForm, name).value = settings[name];
  field(settingsForm, "port").value = settings.service.port;
  field(settingsForm, "portMode").value = settings.service.portMode;
  field(settingsForm, "theme").value = settings.service.theme;
  document.documentElement.dataset.theme = settings.service.theme;
  field(settingsForm, "online").checked = settings.online.enabled;
  field(settingsForm, "publicUrl").value = settings.online.publicUrl;
  for (const name of ["width", "height", "gifFps", "compression"])
    field(settingsForm, name).value = settings.defaults[name];
  $("#onlineFields").disabled = !settings.online.enabled;
  renderSettingsState();
}
function renderSettingsState() {
  $("#passwordState").textContent = t(
    bootstrap.secrets.passwordConfigured ? "configured" : "missing",
  );
  $("#tunnelState").textContent = t(
    bootstrap.secrets.tunnelConfigured ? "configured" : "missing",
  );
  $("#ownerState").textContent = t(
    bootstrap.secrets.ownerPasswordConfigured ? "configured" : "missing",
  );
  const names = {
    runtime: "diagRuntime",
    macos: "diagMac",
    settings: "diagSettings",
    storage: "diagStorage",
    online: "diagOnline",
    "native-image": "diagImage",
    "secret-store-client": "diagSecrets",
  };
  $("#diagnostics").textContent = bootstrap.diagnostic.checks
    .map(
      (check) =>
        t(names[check.name] ?? "diagnostics") +
        ": " +
        t(
          ["passed", "failed", "unconfigured", "unverified"].includes(
            check.status,
          )
            ? check.status
            : "unverified",
        ),
    )
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
  preferences.service.portMode = field(settingsForm, "portMode").value;
  preferences.service.theme = field(settingsForm, "theme").value;
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
        ownerPassword: field(settingsForm, "ownerPassword").value,
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
    field(settingsForm, "ownerPassword").value = "";
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
    renderSettingsState();
    toast(t("diagnosticsDone"));
  } catch (error) {
    report(error);
  }
});
$("#locale").addEventListener("change", (event) => {
  locale = event.target.value;
  translate();
  renderSettingsState();
});
field(settingsForm, "theme").addEventListener("change", (event) => {
  document.documentElement.dataset.theme = event.target.value;
});
$("#search").addEventListener("input", () => {
  searchPage = 0;
  renderGallery();
});
$("#editor").addEventListener("close", () => {
  clearSourceDraft();
  selected = undefined;
  drag = undefined;
  picking = false;
});
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

let connectionView = "";
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
            : state === "owner-password-missing"
              ? "ownerMissing"
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
    const nextView = JSON.stringify([
      locale,
      connections.requests,
      connections.connections,
    ]);
    if (connectionView === nextView) return;
    connectionView = nextView;
    container.replaceChildren();
    for (const request of connections.requests) {
      const paragraph = document.createElement("p");
      paragraph.textContent =
        request.client +
        " · " +
        request.id +
        " · " +
        request.redirect +
        " · " +
        request.clientId +
        " · " +
        t("requestedAccess") +
        ": " +
        request.scope;
      const password = document.createElement("input");
      password.type = "password";
      password.autocomplete = "off";
      password.setAttribute("aria-label", t("approvalPassword"));
      password.placeholder = t("approvalPassword");
      const button = document.createElement("button");
      button.textContent = t("approve");
      button.addEventListener("click", async () => {
        try {
          button.disabled = true;
          await api("/api/connection-approve", {
            id: request.id,
            password: password.value,
          });
          await refreshConnections();
        } catch (error) {
          report(error);
        } finally {
          password.value = "";
          button.disabled = false;
        }
      });
      const reject = document.createElement("button");
      reject.textContent = t("reject");
      reject.addEventListener("click", async () => {
        try {
          await api("/api/connection-reject", { id: request.id });
          await refreshConnections();
        } catch (error) {
          report(error);
        }
      });
      container.append(paragraph, password, button, reject);
    }
    for (const connection of connections.connections ?? []) {
      const paragraph = document.createElement("p");
      paragraph.textContent =
        connection.client +
        " · " +
        connection.id +
        " · " +
        connection.redirect +
        " · " +
        connection.scope;
      const button = document.createElement("button");
      button.textContent = t("revoke");
      button.addEventListener("click", async () => {
        try {
          await api("/api/connection-revoke", { id: connection.id });
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
