const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flightRecorder", {
  listRuns: () => ipcRenderer.invoke("flight:listRuns"),
  getRun: (runId) => ipcRenderer.invoke("flight:getRun", runId),
  initRun: (payload) => ipcRenderer.invoke("flight:initRun", payload),
  recordEvent: (payload) => ipcRenderer.invoke("flight:recordEvent", payload),
  analyze: (runId) => ipcRenderer.invoke("flight:analyze", runId),
  recommend: (payload) => ipcRenderer.invoke("flight:recommend", payload),
  startSupervisor: (payload) => ipcRenderer.invoke("flight:startSupervisor", payload),
  resumeSupervisor: (runId) => ipcRenderer.invoke("flight:resumeSupervisor", runId),
  getSupervisorState: (runId) => ipcRenderer.invoke("flight:getSupervisorState", runId),
});
