@echo off
setlocal enabledelayedexpansion

for %%a in (jump_happy_*.png) do (
    set "old=%%a"
    set "new=!old:jump_happy=cow!"
    ren "%%a" "!new!"
)

endlocal