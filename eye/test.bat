@echo off
setlocal enabledelayedexpansion

for %%a in (001��Ƶգ��_*.png) do (
    set "old=%%a"
    set "new=!old:001��Ƶգ��=cow!"
    ren "%%a" "!new!"
)

endlocal