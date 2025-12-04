// State
let files = [];
let selectedFile = null;
let deviceInfo = null;
let peers = new Map();
let currentEditingFile = null;
let autoSaveTimer = null;
let lastSavedContent = "";

// Utility functions
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

function getFileIcon(fileName, isWordDoc) {
  if (isWordDoc) return "📘";

  const ext = fileName.split(".").pop().toLowerCase();
  const icons = {
    txt: "📄",
    doc: "📘",
    docx: "📘",
    pdf: "📕",
    jpg: "🖼️",
    jpeg: "🖼️",
    png: "🖼️",
    gif: "🖼️",
    mp4: "🎬",
    avi: "🎬",
    mov: "🎬",
    mp3: "🎵",
    wav: "🎵",
    zip: "🗜️",
    rar: "🗜️",
    js: "📜",
    html: "📜",
    css: "📜",
    json: "📜",
    py: "🐍",
    java: "☕",
    folder: "📁",
  };
  return icons[ext] || "📄";
}

function addActivity(message, type = "info") {
  const activityLog = document.getElementById("activity-log");
  const item = document.createElement("div");
  item.className = `activity-item activity-${type}`;
  item.innerHTML = `
        <div class="activity-time">${formatTime(Date.now())}</div>
        <div>${message}</div>
    `;
  activityLog.insertBefore(item, activityLog.firstChild);

  // Keep only last 50 items
  while (activityLog.children.length > 50) {
    activityLog.removeChild(activityLog.lastChild);
  }
}

// Render functions
function renderFiles() {
  const fileGrid = document.getElementById("file-grid");

  if (files.length === 0) {
    fileGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📂</div>
                <div>No files in shared folder</div>
                <div style="font-size: 12px; margin-top: 8px;">Add Word documents to collaborate</div>
            </div>
        `;
    return;
  }

  fileGrid.innerHTML = "";
  files.forEach((file) => {
    const fileItem = document.createElement("div");
    fileItem.className = "file-item";
    if (file.isWordDoc) {
      fileItem.classList.add("word-doc");
    }
    fileItem.dataset.fileName = file.path;

    if (selectedFile === file.path) {
      fileItem.classList.add("selected");
    }

    fileItem.innerHTML = `
            ${file.isWordDoc ? '<div class="word-badge">WORD</div>' : ""}
            <div class="file-menu">
                <button onclick="event.stopPropagation(); deleteFile('${
                  file.path
                }')" title="Delete">🗑️</button>
            </div>
            <div class="file-icon">${getFileIcon(
              file.name,
              file.isWordDoc
            )}</div>
            <div class="file-name">${file.name}</div>
            <div class="file-size">${formatBytes(file.size)}</div>
        `;

    fileItem.onclick = () => selectFile(file.path);
    fileItem.ondblclick = () => openFile(file.path, file.isWordDoc);

    fileGrid.appendChild(fileItem);
  });
}

function renderPeers() {
  const peerList = document.getElementById("peer-list");

  if (peers.size === 0) {
    peerList.innerHTML = `
            <div style="text-align: center; color: #8b949e; font-size: 12px; padding: 20px;">
                No peers connected
            </div>
        `;
    return;
  }

  peerList.innerHTML = "";
  peers.forEach((peer, id) => {
    const peerItem = document.createElement("div");
    peerItem.className = "peer-item";
    peerItem.innerHTML = `
            <div class="peer-status"></div>
            <div>
                <div style="font-weight: 500;">${peer.name}</div>
                <div style="font-size: 11px; color: #8b949e;">${peer.ip}</div>
            </div>
        `;
    peerList.appendChild(peerItem);
  });
}

function selectFile(fileName) {
  selectedFile = fileName;
  renderFiles();
  document.getElementById("delete-btn").style.display = "block";
}

// File operations
async function addFiles() {
  const result = await window.electronAPI.addFile();
  if (result.success) {
    addActivity(`Added ${result.files.length} file(s)`, "success");
  }
}

async function deleteFile(fileName) {
  if (!confirm(`Delete "${fileName}"?`)) return;

  const result = await window.electronAPI.deleteFile(fileName);
  if (result.success) {
    addActivity(`Deleted: ${fileName}`, "info");
    selectedFile = null;
    document.getElementById("delete-btn").style.display = "none";
  } else {
    alert(`Error: ${result.error}`);
  }
}

async function deleteSelected() {
  if (!selectedFile) return;
  await deleteFile(selectedFile);
}

// Word document functions
async function openFile(fileName, isWordDoc) {
  if (isWordDoc) {
    await openWordDocument(fileName);
  } else {
    const ext = fileName.split(".").pop().toLowerCase();
    const editableExts = [
      "txt",
      "js",
      "html",
      "css",
      "json",
      "md",
      "xml",
      "log",
      "py",
    ];

    if (editableExts.includes(ext)) {
      await openTextFile(fileName);
    } else {
      const result = await window.electronAPI.openFile(fileName);
      if (!result.success) {
        alert(`Error: ${result.error}`);
      }
    }
  }
}

async function openWordDocument(fileName) {
  addActivity(`Opening Word document: ${fileName}`, "info");

  const result = await window.electronAPI.readWordDocument(fileName);

  if (result.success) {
    currentEditingFile = fileName;
    document.getElementById("editor-filename").textContent = fileName;
    document.getElementById("editor-textarea").value = result.text;
    document.getElementById("preview-pane").innerHTML = result.html;
    lastSavedContent = result.text;

    document.getElementById("editor-modal").classList.add("active");
    updateSyncStatus("saved");

    // Start auto-save
    startAutoSave();

    addActivity(`Editing: ${fileName}`, "success");
  } else {
    alert(`Error opening Word document: ${result.error}`);
    addActivity(`Failed to open: ${fileName}`, "error");
  }
}

async function openTextFile(fileName) {
  const result = await window.electronAPI.getFileContent(fileName);
  if (result.success) {
    currentEditingFile = fileName;
    document.getElementById("editor-filename").textContent = fileName;
    document.getElementById("editor-textarea").value = result.content;
    document.getElementById("preview-pane").innerHTML =
      '<p style="color: #6c757d;">Preview not available for this file type</p>';
    lastSavedContent = result.content;

    document.getElementById("editor-modal").classList.add("active");
    updateSyncStatus("saved");
    startAutoSave();
  } else {
    alert(`Error: ${result.error}`);
  }
}

async function saveDocument() {
  if (!currentEditingFile) return;

  updateSyncStatus("syncing");
  const content = document.getElementById("editor-textarea").value;

  const ext = currentEditingFile.split(".").pop().toLowerCase();
  let result;

  if (ext === "doc" || ext === "docx") {
    result = await window.electronAPI.saveWordDocument(
      currentEditingFile,
      content
    );
  } else {
    result = await window.electronAPI.saveFileContent(
      currentEditingFile,
      content
    );
  }

  if (result.success) {
    lastSavedContent = content;
    updateSyncStatus("saved");
    addActivity(
      `Saved: ${currentEditingFile} (will sync to all peers)`,
      "success"
    );
  } else {
    updateSyncStatus("error");
    alert(`Error: ${result.error}`);
    addActivity(`Save failed: ${currentEditingFile}`, "error");
  }
}

async function saveAndOpenInWord() {
  await saveDocument();

  if (currentEditingFile) {
    const result = await window.electronAPI.openFile(currentEditingFile);
    if (result.success) {
      addActivity(`Opened in Microsoft Word: ${currentEditingFile}`, "info");
    }
  }
}

function updateSyncStatus(status) {
  const statusEl = document.getElementById("sync-status");

  if (status === "saved") {
    statusEl.innerHTML = "✓ Saved & Synced";
    statusEl.className = "sync-indicator";
  } else if (status === "syncing") {
    statusEl.innerHTML = '<span class="spinning">⟳</span> Saving...';
    statusEl.className = "sync-indicator syncing";
  } else if (status === "error") {
    statusEl.innerHTML = "⚠ Error";
    statusEl.className = "sync-indicator syncing";
  }
}

function startAutoSave() {
  // Clear existing timer
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
  }

  // Auto-save every 5 seconds if content changed
  autoSaveTimer = setInterval(() => {
    const currentContent = document.getElementById("editor-textarea").value;
    if (currentContent !== lastSavedContent) {
      saveDocument();
    }
  }, 5000);
}

function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function closeEditor() {
  // Save before closing if there are unsaved changes
  const currentContent = document.getElementById("editor-textarea").value;
  if (currentContent !== lastSavedContent) {
    if (confirm("You have unsaved changes. Save before closing?")) {
      saveDocument();
    }
  }

  stopAutoSave();
  document.getElementById("editor-modal").classList.remove("active");
  currentEditingFile = null;
  lastSavedContent = "";
}

async function createNewWord() {
  const fileName = prompt("Enter Word document name:", "Document.docx");
  if (!fileName) return;

  // Ensure .docx extension
  const finalName = fileName.endsWith(".docx") ? fileName : fileName + ".docx";

  const result = await window.electronAPI.createNewWordDocument(finalName);
  if (result.success) {
    addActivity(`Created new Word document: ${finalName}`, "success");
    setTimeout(() => refreshFiles(), 500);
  } else {
    alert(`Error: ${result.error}`);
  }
}

async function createNewFolder() {
  const folderName = prompt("Enter folder name:");
  if (!folderName) return;

  const result = await window.electronAPI.createFolder(folderName);
  if (result.success) {
    addActivity(`Created folder: ${folderName}`, "success");
  } else {
    alert(`Error: ${result.error}`);
  }
}

async function refreshFiles() {
  const result = await window.electronAPI.getFiles();
  files = result;
  renderFiles();
  addActivity("Files refreshed", "info");
}

function openSharedFolder() {
  window.electronAPI.openFolder();
}

async function connectToPeer() {
  const input = document.getElementById("peer-ip-input");
  const peerIP = input.value.trim();

  if (!peerIP) {
    alert("Please enter a peer IP address");
    return;
  }

  addActivity(`Connecting to ${peerIP}...`, "info");
  const result = await window.electronAPI.connectPeer(peerIP);

  if (result.success) {
    addActivity(`Connected to ${peerIP}`, "success");
    input.value = "";
  } else {
    addActivity(`Failed to connect to ${peerIP}`, "error");
  }
}

// Event listeners from main process
window.electronAPI.onDeviceInfo((info) => {
  deviceInfo = info;
  document.getElementById("device-name").textContent = info.name;
  document.getElementById("device-ip").textContent = info.ip;
  document.getElementById("device-id").textContent = info.id;
  addActivity(`Device initialized: ${info.name}`, "success");
});

window.electronAPI.onInitialFiles((fileList) => {
  files = fileList;
  renderFiles();

  const wordDocs = fileList.filter((f) => f.isWordDoc);
  if (wordDocs.length > 0) {
    addActivity(
      `Found ${wordDocs.length} Word document(s) in shared folder`,
      "info"
    );
  }
});

window.electronAPI.onFileChange((fileInfo) => {
  const action =
    fileInfo.event === "add"
      ? "Added"
      : fileInfo.event === "change"
      ? "Modified"
      : "Deleted";

  const fileType = fileInfo.isWordDoc ? "Word document" : "file";

  if (fileInfo.deviceId === deviceInfo?.id) {
    addActivity(`${action} ${fileType} locally: ${fileInfo.path}`, "info");
  } else {
    addActivity(
      `${action} ${fileType} by ${fileInfo.deviceName}: ${fileInfo.path}`,
      "success"
    );

    // If currently editing this file, ask to reload
    if (currentEditingFile === fileInfo.path && fileInfo.event === "change") {
      if (
        confirm(
          `${fileInfo.deviceName} updated "${fileInfo.path}". Reload to see changes?`
        )
      ) {
        closeEditor();
        setTimeout(() => {
          const file = files.find((f) => f.path === fileInfo.path);
          if (file) {
            openFile(file.path, file.isWordDoc);
          }
        }, 500);
      }
    }
  }

  // Refresh file list
  refreshFiles();
});

window.electronAPI.onFileSynced((fileInfo) => {
  addActivity(
    `Synced from ${fileInfo.deviceName}: ${fileInfo.path}`,
    "success"
  );
});

window.electronAPI.onPeerConnected((peerInfo) => {
  peers.set(peerInfo.id, peerInfo);
  renderPeers();
  addActivity(`Peer connected: ${peerInfo.name} (${peerInfo.ip})`, "success");
});

window.electronAPI.onPeerDisconnected((peerId) => {
  const peer = peers.get(peerId);
  if (peer) {
    addActivity(`Peer disconnected: ${peer.name}`, "info");
    peers.delete(peerId);
    renderPeers();
  }
});

window.electronAPI.onPeerFiles((data) => {
  addActivity(
    `Received ${data.files.length} files from ${data.peerIP}`,
    "info"
  );
});

// Live preview for editor
document.addEventListener("DOMContentLoaded", () => {
  const textarea = document.getElementById("editor-textarea");
  if (textarea) {
    textarea.addEventListener("input", () => {
      // Simple preview - convert line breaks to paragraphs
      const content = textarea.value;
      const preview = document.getElementById("preview-pane");

      if (content.trim()) {
        const paragraphs = content
          .split("\n\n")
          .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
          .join("");
        preview.innerHTML = paragraphs;
      } else {
        preview.innerHTML =
          '<p style="color: #6c757d;">Preview will appear here...</p>';
      }
    });
  }
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + S to save in editor
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    if (document.getElementById("editor-modal").classList.contains("active")) {
      e.preventDefault();
      saveDocument();
    }
  }

  // Escape to close editor
  if (e.key === "Escape") {
    if (document.getElementById("editor-modal").classList.contains("active")) {
      closeEditor();
    }
  }

  // Delete key to delete selected file
  if (
    e.key === "Delete" &&
    selectedFile &&
    !document.getElementById("editor-modal").classList.contains("active")
  ) {
    deleteSelected();
  }
});

// Initialize
console.log("Word Collaboration Renderer initialized");
