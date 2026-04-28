@echo off
REM Double-click this to run the weekly Supabase backup.
REM Calls scripts\backup-supabase.ps1 with execution policy bypass
REM so PowerShell will run the .ps1 without a one-time setup prompt.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-supabase.ps1"
echo.
pause
