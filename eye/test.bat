@echo off
setlocal enabledelayedexpansion

for %%a in (001¸ßÆµÕ£ÑÛ_*.png) do (
    set "old=%%a"
    set "new=!old:001¸ßÆµÕ£ÑÛ=cow!"
    ren "%%a" "!new!"
)

endlocal