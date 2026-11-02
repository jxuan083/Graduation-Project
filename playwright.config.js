import { defineConfig } from '@playwright/test';
const python = process.env.PYTHON || 'python';
export default defineConfig({
    testDir:'./e2e', workers:1, timeout:45000, retries:process.env.CI?1:0,
    use:{baseURL:'http://127.0.0.1:5191',viewport:{width:390,height:844},trace:'retain-on-failure'},
    webServer:[
        {command:`${python} -m http.server 5191 --bind 127.0.0.1 --directory frontend`,url:'http://127.0.0.1:5191',reuseExistingServer:false},
        {command:`${python} -m uvicorn browser_review_server:app --app-dir scripts --host 127.0.0.1 --port 8093`,url:'http://127.0.0.1:8093/api/health',reuseExistingServer:false},
    ],
});
