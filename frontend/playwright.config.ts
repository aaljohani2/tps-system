import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',
  timeout:60000,
  use:{baseURL:'http://127.0.0.1:8787',headless:true,trace:'retain-on-failure'},
  reporter:'list'
});
