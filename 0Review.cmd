@echo off
setlocal EnableExtensions
cd /d "%~dp0" || exit /b 1
where node >nul 2>&1
if errorlevel 1 (
  echo FIELDWEAVER review requires Node.js 22 or 24.
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo FIELDWEAVER review requires npm.
  exit /b 1
)
where git >nul 2>&1
if errorlevel 1 (
  echo FIELDWEAVER review needs Git and one-time GitHub access to verify the pinned Draft heads.
  exit /b 1
)
call npm run verify
if errorlevel 1 (
  echo Verification failed. No review was opened.
  exit /b 1
)
set "REVIEW="
for /L %%N in (1,1,999) do if not defined REVIEW if not exist "FIELDWEAVER-admission-review-%%N.html" set "REVIEW=FIELDWEAVER-admission-review-%%N.html"
if not defined REVIEW (
  echo Review slots exhausted. No existing review was overwritten.
  exit /b 1
)
node scripts\admission-review.mjs --out "%REVIEW%"
if errorlevel 1 (
  echo Source-exact review failed. No stale artwork review was opened.
  exit /b 1
)
echo Verified offline review: "%CD%\%REVIEW%"
echo Accepted reference works and unmerged Drafts are labelled separately.
start "" "%CD%\%REVIEW%"
if errorlevel 1 (
  echo Open "%CD%\%REVIEW%" manually in Firefox.
)
exit /b 0
