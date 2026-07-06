@echo off
"C:\Users\yhj\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" "%~dp0hook_event.py" --event-type tool_call --hook pre-tool-use %*
