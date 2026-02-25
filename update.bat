@echo off
echo =======================================================
echo    Canada ExpGroup — Map Update ^& GitHub Push
echo =======================================================
echo.

echo 1. Fetching API data and rebuilding data.js from MapDeptGroup.xlsx...
node update-data.js
if %errorlevel% neq 0 (
    echo.
    echo ❌ Data build failed! Please check the error above.
    pause
    exit /b %errorlevel%
)
echo.

echo 2. Checking for changes...
git status -s
echo.

echo 3. Staging changes...
git add data.js
git add MapDeptGroup.xlsx
git add index.html index.css app.js
echo.

echo 4. Committing changes...
git commit -m "Auto-update: Refresh API data and department map"
if %errorlevel% neq 0 (
    echo.
    echo ℹ️ No changes to commit — everything is already up to date.
    pause
    exit /b 0
)
echo.

echo 5. Pushing to GitHub...
git push
if %errorlevel% neq 0 (
    echo.
    echo ❌ Push failed! Check your internet connection or git permissions.
    pause
    exit /b %errorlevel%
)

echo.
echo ✅ ALL DONE! The data has been refreshed from the API and pushed.
echo ⏳ It may take 1-2 minutes for GitHub Pages to reflect the changes.
echo.
pause
