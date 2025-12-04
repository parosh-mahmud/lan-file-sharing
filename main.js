const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const chokidar = require("chokidar");
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const socketClient = require("socket.io-client");
const crypto = require("crypto");
const os = require("os");
const mammoth = require("mammoth");
const { Document, Packer, Paragraph, TextRun } = require("docx");

// Global variables
let mainWindow;
let localServer;
let io;
let peerConnections = new Map();
let sharedFolder;
const PORT = 8888;

// Device info
const deviceInfo = {
  id: crypto.randomBytes(8).toString("hex"),
  name: os.hostname() || "LANShare-Device",
  ip: getLocalIP(),
};

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

// Shared folder management
function initializeSharedFolder() {
  const userDataPath = app.getPath("userData");
  sharedFolder = path.join(userDataPath, "SharedFiles");

  if (!fs.existsSync(sharedFolder)) {
    fs.mkdirSync(sharedFolder, { recursive: true });
  }

  console.log("Shared folder initialized:", sharedFolder);
  return sharedFolder;
}

// Word document conversion functions
async function convertWordToHtml(filePath) {
  try {
    const result = await mammoth.convertToHtml({ path: filePath });
    return {
      success: true,
      html: result.value,
      messages: result.messages,
    };
  } catch (err) {
    console.error("Error converting Word to HTML:", err);
    return { success: false, error: err.message };
  }
}

async function convertWordToText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      success: true,
      text: result.value,
    };
  } catch (err) {
    console.error("Error extracting text from Word:", err);
    return { success: false, error: err.message };
  }
}

async function createWordDocument(content, outputPath) {
  try {
    // Split content into paragraphs
    const paragraphs = content.split("\n").map(
      (line) =>
        new Paragraph({
          children: [new TextRun(line || " ")],
        })
    );

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);

    return { success: true };
  } catch (err) {
    console.error("Error creating Word document:", err);
    return { success: false, error: err.message };
  }
}

// File system watcher with Word document support
function watchSharedFolder() {
  const watcher = chokidar.watch(sharedFolder, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  watcher
    .on("add", (filePath) => handleFileChange("add", filePath))
    .on("change", (filePath) => handleFileChange("change", filePath))
    .on("unlink", (filePath) => handleFileChange("delete", filePath));

  console.log("File watcher started");
  return watcher;
}

function handleFileChange(event, filePath) {
  const relativePath = path.relative(sharedFolder, filePath);
  console.log(`File ${event}:`, relativePath);

  const fileInfo = {
    event,
    path: relativePath,
    deviceId: deviceInfo.id,
    deviceName: deviceInfo.name,
    timestamp: Date.now(),
  };

  if (event === "add" || event === "change") {
    try {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath);

      fileInfo.size = stats.size;
      fileInfo.content = content.toString("base64");
      fileInfo.mtime = stats.mtime.getTime();

      // Detect file type
      const ext = path.extname(filePath).toLowerCase();
      fileInfo.isWordDoc = [".doc", ".docx"].includes(ext);
    } catch (err) {
      console.error("Error reading file:", err);
      return;
    }
  }

  // Broadcast to all connected peers
  broadcastToPeers("file-change", fileInfo);

  // Send to renderer
  if (mainWindow) {
    mainWindow.webContents.send("file-change", fileInfo);
  }
}

// HTTP + Socket.IO Server
function startServer() {
  const expressApp = express();
  localServer = http.createServer(expressApp);
  io = socketIO(localServer, {
    cors: { origin: "*" },
    maxHttpBufferSize: 100 * 1024 * 1024, // 100MB for large Word docs
  });

  // Serve shared files
  expressApp.use("/files", express.static(sharedFolder));

  // API to list files
  expressApp.get("/api/files", (req, res) => {
    const files = getFileList();
    res.json({ files, deviceInfo });
  });

  // Socket.IO connections
  io.on("connection", (socket) => {
    console.log("Peer connected:", socket.id);

    socket.on("register-device", (info) => {
      peerConnections.set(socket.id, {
        socket,
        deviceInfo: info,
        connectedAt: Date.now(),
      });

      console.log("Device registered:", info.name);

      // Send current file list
      const files = getFileList();
      socket.emit("initial-files", files);

      // Notify renderer
      if (mainWindow) {
        mainWindow.webContents.send("peer-connected", info);
      }
    });

    socket.on("file-change", (fileInfo) => {
      handleRemoteFileChange(fileInfo);
    });

    socket.on("request-file", (fileName, callback) => {
      const filePath = path.join(sharedFolder, fileName);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "base64");
        callback({ success: true, content });
      } else {
        callback({ success: false, error: "File not found" });
      }
    });

    socket.on("disconnect", () => {
      const peer = peerConnections.get(socket.id);
      if (peer) {
        console.log("Peer disconnected:", peer.deviceInfo.name);
        if (mainWindow) {
          mainWindow.webContents.send("peer-disconnected", peer.deviceInfo.id);
        }
        peerConnections.delete(socket.id);
      }
    });
  });

  localServer.listen(PORT, () => {
    console.log(`Server running on http://${deviceInfo.ip}:${PORT}`);
  });
}

function handleRemoteFileChange(fileInfo) {
  // Don't process our own changes
  if (fileInfo.deviceId === deviceInfo.id) return;

  const filePath = path.join(sharedFolder, fileInfo.path);

  try {
    if (fileInfo.event === "delete") {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("File deleted:", fileInfo.path);
      }
    } else {
      // Create directory if needed
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      const content = Buffer.from(fileInfo.content, "base64");
      fs.writeFileSync(filePath, content);

      // Set modification time
      if (fileInfo.mtime) {
        fs.utimesSync(filePath, new Date(), new Date(fileInfo.mtime));
      }

      console.log(`File ${fileInfo.event}:`, fileInfo.path);
    }

    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send("file-synced", fileInfo);
    }
  } catch (err) {
    console.error("Error handling remote file change:", err);
  }
}

function getFileList() {
  const files = [];

  function scanDir(dir, prefix = "") {
    const items = fs.readdirSync(dir);

    items.forEach((item) => {
      const fullPath = path.join(dir, item);
      const relativePath = path.join(prefix, item);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        scanDir(fullPath, relativePath);
      } else {
        const ext = path.extname(item).toLowerCase();
        files.push({
          name: item,
          path: relativePath,
          size: stats.size,
          mtime: stats.mtime.getTime(),
          isDirectory: false,
          isWordDoc: [".doc", ".docx"].includes(ext),
        });
      }
    });
  }

  if (fs.existsSync(sharedFolder)) {
    scanDir(sharedFolder);
  }

  return files;
}

function broadcastToPeers(event, data) {
  io.emit(event, data);
}

// Connect to peer
async function connectToPeer(peerIP) {
  const peerURL = `http://${peerIP}:${PORT}`;

  try {
    const socket = socketClient(peerURL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socket.on("connect", () => {
      console.log("Connected to peer:", peerIP);
      socket.emit("register-device", deviceInfo);
    });

    socket.on("initial-files", (files) => {
      console.log("Received initial files:", files.length);
      if (mainWindow) {
        mainWindow.webContents.send("peer-files", { peerIP, files });
      }
    });

    socket.on("file-change", (fileInfo) => {
      handleRemoteFileChange(fileInfo);
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from peer:", peerIP);
    });

    return { success: true, socket };
  } catch (err) {
    console.error("Connection error:", err);
    return { success: false, error: err.message };
  }
}

// Create Electron window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    backgroundColor: "#0d1117",
    icon: path.join(__dirname, "assets/icon.png"),
  });

  mainWindow.loadFile("renderer/index.html");

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// App initialization
app.whenReady().then(() => {
  createWindow();

  // Initialize shared folder
  const folder = initializeSharedFolder();

  // Start file watcher
  watchSharedFolder();

  // Start server
  startServer();

  // Send device info to renderer
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("device-info", {
      ...deviceInfo,
      sharedFolder: folder,
    });

    // Send initial file list
    const files = getFileList();
    mainWindow.webContents.send("initial-files", files);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// IPC Handlers
ipcMain.handle("get-files", () => {
  return getFileList();
});

ipcMain.handle("open-folder", () => {
  shell.openPath(sharedFolder);
});

ipcMain.handle("connect-peer", async (event, peerIP) => {
  return await connectToPeer(peerIP);
});

ipcMain.handle("add-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "All Files", extensions: ["*"] },
      { name: "Word Documents", extensions: ["doc", "docx"] },
      { name: "Text Files", extensions: ["txt"] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const addedFiles = [];

    for (const sourcePath of result.filePaths) {
      const fileName = path.basename(sourcePath);
      const destPath = path.join(sharedFolder, fileName);

      try {
        fs.copyFileSync(sourcePath, destPath);
        addedFiles.push(fileName);
      } catch (err) {
        console.error("Error copying file:", err);
      }
    }

    return { success: true, files: addedFiles };
  }

  return { success: false };
});

ipcMain.handle("create-folder", async (event, folderName) => {
  const folderPath = path.join(sharedFolder, folderName);

  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      return { success: true };
    }
    return { success: false, error: "Folder already exists" };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("delete-file", async (event, fileName) => {
  const filePath = path.join(sharedFolder, fileName);

  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
      return { success: true };
    }
    return { success: false, error: "File not found" };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-file", async (event, fileName) => {
  const filePath = path.join(sharedFolder, fileName);

  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("rename-file", async (event, oldName, newName) => {
  const oldPath = path.join(sharedFolder, oldName);
  const newPath = path.join(sharedFolder, newName);

  try {
    fs.renameSync(oldPath, newPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Word document specific handlers
ipcMain.handle("read-word-document", async (event, fileName) => {
  const filePath = path.join(sharedFolder, fileName);

  try {
    // Convert to HTML for display
    const htmlResult = await convertWordToHtml(filePath);

    // Also get plain text for editing
    const textResult = await convertWordToText(filePath);

    if (htmlResult.success && textResult.success) {
      return {
        success: true,
        html: htmlResult.html,
        text: textResult.text,
        fileName,
      };
    } else {
      return {
        success: false,
        error: htmlResult.error || textResult.error,
      };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("save-word-document", async (event, fileName, content) => {
  const filePath = path.join(sharedFolder, fileName);

  try {
    // Create new Word document from content
    const result = await createWordDocument(content, filePath);

    if (result.success) {
      return { success: true };
    } else {
      return { success: false, error: result.error };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("create-new-word-document", async (event, fileName) => {
  const filePath = path.join(sharedFolder, fileName);

  try {
    const defaultContent = "New Document\n\nStart typing here...";
    const result = await createWordDocument(defaultContent, filePath);

    if (result.success) {
      return { success: true, fileName };
    } else {
      return { success: false, error: result.error };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-file-content", async (event, fileName) => {
  const filePath = path.join(sharedFolder, fileName);

  try {
    const content = fs.readFileSync(filePath, "utf8");
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("save-file-content", async (event, fileName, content) => {
  const filePath = path.join(sharedFolder, fileName);

  try {
    fs.writeFileSync(filePath, content, "utf8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Cleanup
app.on("window-all-closed", () => {
  if (localServer) {
    localServer.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  if (localServer) {
    localServer.close();
  }
});
