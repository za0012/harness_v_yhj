const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flightRecorder", {
  listRuns: () => ipcRenderer.invoke("flight:listRuns"),
  deleteRun: (runId) => ipcRenderer.invoke("flight:deleteRun", runId),
  getRun: (runId) => ipcRenderer.invoke("flight:getRun", runId),
  initRun: (payload) => ipcRenderer.invoke("flight:initRun", payload),
  recordEvent: (payload) => ipcRenderer.invoke("flight:recordEvent", payload),
  analyze: (runId) => ipcRenderer.invoke("flight:analyze", runId),
  recommend: (payload) => ipcRenderer.invoke("flight:recommend", payload),
  compareRuns: (payload) => ipcRenderer.invoke("flight:compareRuns", payload),
  importTranscript: (payload) => ipcRenderer.invoke("flight:importTranscript", payload),
  importLatestCodexThread: (payload) => ipcRenderer.invoke("flight:importLatestCodexThread", payload),
  listCodexThreads: (payload) => ipcRenderer.invoke("flight:listCodexThreads", payload),
  startLiveWatcher: (payload) => ipcRenderer.invoke("flight:startLiveWatcher", payload),
  stopLiveWatcher: () => ipcRenderer.invoke("flight:stopLiveWatcher"),
  getLiveWatcherStatus: (payload) => ipcRenderer.invoke("flight:getLiveWatcherStatus", payload),
  startSupervisor: (payload) => ipcRenderer.invoke("flight:startSupervisor", payload),
  startAutopilot: (payload) => ipcRenderer.invoke("flight:startAutopilot", payload),
  resumeSupervisor: (runId) => ipcRenderer.invoke("flight:resumeSupervisor", runId),
  getSupervisorState: (runId) => ipcRenderer.invoke("flight:getSupervisorState", runId),
});
