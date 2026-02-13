import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // <--- ⭐ 이 줄이 없으면 흰 화면이 뜹니다! 꼭 추가하세요.
})