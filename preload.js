const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // File operations
  getFiles: () => ipcRenderer.invoke("get-files"),
  addFile: () => ipcRenderer.invoke("add-file"),
  deleteFile: (fileName) => ipcRenderer.invoke("delete-file", fileName),
  openFile: (fileName) => ipcRenderer.invoke("open-file", fileName),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  createFolder: (folderName) => ipcRenderer.invoke("create-folder", folderName),
  renameFile: (oldName, newName) =>
    ipcRenderer.invoke("rename-file", oldName, newName),
  getFileContent: (fileName) =>
    ipcRenderer.invoke("get-file-content", fileName),
  saveFileContent: (fileName, content) =>
    ipcRenderer.invoke("save-file-content", fileName, content),

  // Word document specific operations
  readWordDocument: (fileName) =>
    ipcRenderer.invoke("read-word-document", fileName),
  saveWordDocument: (fileName, content) =>
    ipcRenderer.invoke("save-word-document", fileName, content),
  createNewWordDocument: (fileName) =>
    ipcRenderer.invoke("create-new-word-document", fileName),

  // Peer operations
  connectPeer: (peerIP) => ipcRenderer.invoke("connect-peer", peerIP),

  // Event listeners
  onDeviceInfo: (callback) => {
    ipcRenderer.on("device-info", (event, data) => callback(data));
  },

  onInitialFiles: (callback) => {
    ipcRenderer.on("initial-files", (event, files) => callback(files));
  },

  onFileChange: (callback) => {
    ipcRenderer.on("file-change", (event, fileInfo) => callback(fileInfo));
  },

  onFileSynced: (callback) => {
    ipcRenderer.on("file-synced", (event, fileInfo) => callback(fileInfo));
  },

  onPeerConnected: (callback) => {
    ipcRenderer.on("peer-connected", (event, peerInfo) => callback(peerInfo));
  },

  onPeerDisconnected: (callback) => {
    ipcRenderer.on("peer-disconnected", (event, peerId) => callback(peerId));
  },

  onPeerFiles: (callback) => {
    ipcRenderer.on("peer-files", (event, data) => callback(data));
  },
});
