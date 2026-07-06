const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flightRecorder", {
  listRuns: () => ipcRenderer.invoke("flight:listRuns"),
  getRun: (runId) => ipcRenderer.invoke("flight:getRun", runId),
  initRun: (payload) => ipcRenderer.invoke("flight:initRun", payload),
  recordEvent: (payload) => ipcRenderer.invoke("flight:recordEvent", payload),
  analyze: (runId) => ipcRenderer.invoke("flight:analyze", runId),
  recommend: (payload) => ipcRenderer.invoke("flight:recommend", payload),
  compareRuns: (payload) => ipcRenderer.invoke("flight:compareRuns", payload),
  importTranscript: (payload) => ipcRenderer.invoke("flight:importTranscript", payload),
  startSupervisor: (payload) => ipcRenderer.invoke("flight:startSupervisor", payload),
  startAutopilot: (payload) => ipcRenderer.invoke("flight:startAutopilot", payload),
  resumeSupervisor: (runId) => ipcRenderer.invoke("flight:resumeSupervisor", runId),
  getSupervisorState: (runId) => ipcRenderer.invoke("flight:getSupervisorState", runId),
});
