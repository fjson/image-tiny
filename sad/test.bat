@echo off
setlocal enabledelayedexpansion

for %%a in (020����̾��_*.png) do (
    set "old=%%a"
    set "new=!old:020����̾��=cow!"
    ren "%%a" "!new!"
)

endlocal