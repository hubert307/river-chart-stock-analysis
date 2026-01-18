import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // 讀取環境變數
    const env = loadEnv(mode, '.', '');
    
    return {
      // 1. 設定基礎路徑：這讓你的網頁資源（JS/CSS）能從子目錄正確載入
      base: '/river-chart-stock-analysis/', 

      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      
      // 2. 定義環境變數：確保 Gemini API Key 能被程式碼讀取
      define: {
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      
      resolve: {
        alias: {
          // 保持你原本的別名設定
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});