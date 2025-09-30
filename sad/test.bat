@echo off
setlocal enabledelayedexpansion

for %%a in (020伤心叹气_*.png) do (
    set "old=%%a"
    set "new=!old:020伤心叹气=cow!"
    ren "%%a" "!new!"
)

endlocal